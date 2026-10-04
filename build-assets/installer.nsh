; ============================================================================
;  MarkdownToWord — NSIS custom installer script
; ----------------------------------------------------------------------------
;  Scope, deliberately one thing: an opt-in checkbox that appends the install
;  directory to the user PATH so `m2w` is callable from a terminal.
;
;  Why a custom page at all: the four documented shortcut keys
;  (createStartMenuShortcut / createDesktopShortcut / shortcutName /
;  menuCategory) all hardcode their target to "$appExe" in electron-builder's
;  own templates, and `nsis.shortcuts` does not exist in 26.x. Adding a PATH
;  entry is not a shortcut, so no documented key could express it either way.
;
;  Why `customPageAfterChangeDir` and not `customInstall`: that hook sits in
;  assistedInstaller.nsh between MUI_PAGE_DIRECTORY and MUI_PAGE_INSTFILES —
;  after the user has settled the install directory, before anything is written.
;  `customInstall` runs inside the install section, far too late to ask a
;  question, and it is also reached under /S where there is no UI to ask.
;
;  Why not the components page: electron-builder's assisted *installer* has no
;  components page (only the uninstaller can get one, via customUnInstallSection),
;  so there is no existing installer page to hang a checkbox on.
;
;  Default is UNCHECKED — that is the whole meaning of "with consent". Under /S
;  the page never runs at all, so a silent install leaves PATH untouched.
; ============================================================================

!include "nsDialogs.nsh"
!include "StrFunc.nsh"

; --- StrFunc 预热(必须,否则本文件根本编不过) ---------------------------------
; ${StrStr} 是惰性初始化的:首次**带参**调用会报
; "macro FUNCTION_STRING_StrStr requires 0 parameter(s), passed 3",
; 因为真正的 Function 与宏改写要等一次裸调用之后才存在。
;
; 多 include 约定:裸调用**不幂等** —— 预热后 ${StrStr} 已被改写成 _Call 变体,
; 再裸调一次就会反过来报 "requires 3 parameters, passed 0"(实测)。
; 所以必须用 StrFunc 自己留下的 StrStr_INCLUDED 做守卫:将来若有第二个 .nsh
; 也需要 StrFunc,照抄下面这个宏即可,连插多次都成立(实测三次)。
; 也别把预热挪进 Section/Function —— Function 声明在那里不合法,会报
; "command Function not valid in Section"。
;
; 预热本身也必须按 BUILD_UNINSTALLER 守卫:${StrStr} 这次裸调**就是**在生成
; Function StrStr,而本文件唯一用它的地方(m2w.ApplyPath)只在安装器那趟存在。
; 卸载器那趟若照样预热,就会多出一个无人调用的 StrStr,报
; "warning 6010: install function \"StrStr\" not referenced - zeroing code out",
; electron-builder --warnings-as-errors 照样让它失败。!include StrFunc.nsh 本身
; 不生成 Function(只是宏定义),所以留在守卫外、始终 include 是安全的。
!macro M2W_EnsureStrFunc
  !ifndef StrStr_INCLUDED
    ${StrStr}
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
  !insertmacro M2W_EnsureStrFunc
!endif

; 卸载侧函数名单源化。NSIS **没有**「函数是否存在」的编译期检查:把 Call 的
; 目标改成一个不存在的名字,编译照样过(实测),要到运行期才炸。所以名字只写
; 一处,Call 与 Function 都从这里取 —— 两者不可能写歪。附带的编译期收益:漏掉
; "un." 前缀会被 NSIS 直接拦下("Call must be used with function names starting
; with un. in the uninstall section")。
!define M2W_RESTORE_FN "un.m2w.RestorePath"

; 本安装器动过 PATH 的记录。两份都要:before 用来精确还原,written 用来分辨
; 「还是我写的那份」与「用户后来改过」。
;
; 固定写 HKCU 而非 electron-builder 的 SHELL_CONTEXT:被描述的对象
; (HKCU\Environment\Path)恒为用户级,把账本钉在同一巢里才不会因选了
; 「所有用户」安装而让卸载侧读不到自己的记录。清理不依赖 electron-builder
; 删安装键 —— 两个值都由 RestorePath 显式 DeleteRegValue。
;
; 键名自己拼而**不用** ${INSTALL_REGISTRY_KEY}:那个符号由 multiUser.nsh 定义,
; 而 multiUser.nsh 是 installer.nsi 第 10 行才 include 的 —— 晚于本文件(本文件
; 被 electron-builder 前置到 installer.nsi 头部)。在本文件里引用它会报
; "warning 6000: unknown variable/constant {INSTALL_REGISTRY_KEY}",而
; electron-builder 把 warning 当 error,于是安装器与卸载器两趟全挂。
; 这里的拼法与 multiUser.nsh 的 !define /ifndef 默认值逐字相同,所以两处落在
; 同一个键上;差别只在于本文件不依赖「别人先定义过」。${APP_GUID} 是命令行
; define(见日志 "Command line defined: APP_GUID=..."),从脚本第一行起就可用。
!define M2W_LEDGER_KEY "Software\${APP_GUID}"
!define M2W_BEFORE "M2WPathBefore"
!define M2W_WRITTEN "M2WPathWritten"

; 写入 PATH 的长度上限(字符)。超过就不写。
;
; 取值依据:环境块(用户变量 + 系统变量合计)的硬上限是 32767 字符,超了
; CreateProcess 会失败。8191 远高于任何正常单条 PATH,又给其余变量留足余量。
; 之所以**宁可放弃也不截断**:截断会直接毁掉用户剩下的整条 PATH,那比没写
; 坏得多;放弃只让这一次勾选不生效,且下面会把原因告诉用户。
!define M2W_PATH_MAX 8191

; --- LangString 覆盖面 ---------------------------------------------------------
; ⚠ 别把这段缩回「每个串只写 zh-CN + en-US 两行」—— 那样编不过。
;
; NSIS 要求**每一条** LangString 在**每一个**已加载语言表里都有值,缺一条就报
; "warning 6040: LangString ... is not set in language table of language X",
; 而 electron-builder 以 --warnings-as-errors 调 makensis,于是安装器与卸载器
; 两趟一起失败。
;
; 为什么是全部 26 种:nsis.installerLanguages 未设 ⇒ LangConfigurator 取
; langs.bundledLanguages 全量(app-builder-lib/out/util/langs.js),并为每种
; !insertmacro MUI_LANGUAGE。**注意 build.win.electronLanguages 管的是
; Electron 应用界面语言,不是 NSIS 安装器语言** —— 二者名字相近但不是一回事,
; 早先按前者只写两行是错的。
;
; 覆盖策略:zh-CN 给中文,其余 25 种一律回落英文(1033)。不编造机器翻译,
; 英文对所有语种都是可读的;真要加语种就在下面那张表里加一行 LCID + 文案。
;
; ⚠ LCID 必须逐字取自 NSIS 自带的 `Contrib\Language files\<Name>.nlf` 里
; "# Language ID" 下一行 —— **不能**照着 locale 名字推。踩过的坑:es_ES 的
; LCID 是 **3082**(SpanishInternational),不是常被引用的 1034(那个属于
; Spanish.nlf,electron-builder 根本不加载它)。写错的后果很隐蔽:NSIS 会
; **为凭空声明的 LCID 新建一张空语言表**,于是又报
; warning 6040 "MUI_UNTEXT_WELCOME_INFO_TITLE is not set in language
; table of language 1034" —— 报错的是 MUI2 自己的字符串,跟本文件八竿子
; 打不着,极易误判成 electron-builder 的 bug。别按 locale 名猜。
;
; 26 种的对应(取自各 .nlf 的 "# Language ID",与 electron-builder 实际
; !insertmacro MUI_LANGUAGE 的顺序一致):
;   1033 en_US   1031 de_DE   1036 fr_FR   3082 es_ES   2052 zh_CN
;   1028 zh_TW   1041 ja_JP   1042 ko_KR   1040 it_IT   1043 nl_NL
;   1030 da_DK   1053 sv_SE   1044 nb_NO   1035 fi_FI   1049 ru_RU
;   2070 pt_PT   1046 pt_BR   1045 pl_PL   1058 uk_UA   1029 cs_CZ
;   1051 sk_SK   1038 hu_HU   1025 ar_SA   1055 tr_TR   1054 th_TH
;   1066 vi_VN
!macro M2W_LangString NAME EN_ZH_CN EN_EN_US
  LangString ${NAME} 1033 "${EN_EN_US}"
  LangString ${NAME} 1031 "${EN_EN_US}"
  LangString ${NAME} 1036 "${EN_EN_US}"
  LangString ${NAME} 3082 "${EN_EN_US}"
  LangString ${NAME} 2052 "${EN_ZH_CN}"
  LangString ${NAME} 1028 "${EN_EN_US}"
  LangString ${NAME} 1041 "${EN_EN_US}"
  LangString ${NAME} 1042 "${EN_EN_US}"
  LangString ${NAME} 1040 "${EN_EN_US}"
  LangString ${NAME} 1043 "${EN_EN_US}"
  LangString ${NAME} 1030 "${EN_EN_US}"
  LangString ${NAME} 1053 "${EN_EN_US}"
  LangString ${NAME} 1044 "${EN_EN_US}"
  LangString ${NAME} 1035 "${EN_EN_US}"
  LangString ${NAME} 1049 "${EN_EN_US}"
  LangString ${NAME} 2070 "${EN_EN_US}"
  LangString ${NAME} 1046 "${EN_EN_US}"
  LangString ${NAME} 1045 "${EN_EN_US}"
  LangString ${NAME} 1058 "${EN_EN_US}"
  LangString ${NAME} 1029 "${EN_EN_US}"
  LangString ${NAME} 1051 "${EN_EN_US}"
  LangString ${NAME} 1038 "${EN_EN_US}"
  LangString ${NAME} 1025 "${EN_EN_US}"
  LangString ${NAME} 1055 "${EN_EN_US}"
  LangString ${NAME} 1054 "${EN_EN_US}"
  LangString ${NAME} 1066 "${EN_EN_US}"
!macroend

; 超长而放弃写入时给用户看的话。不能只写日志 —— 静默跳过的话,用户的判断是
; 「我勾了但没生效」,而真实原因是长度,两边对不上,下次还会遇到。
; 声明在这里而不是复用 electron-builder 的 $(...) 串:那些来自工具自带的
; messages yml,本仓不该改它。LCID 用数字而非 LANG_* 符号,因为后者要等
; MUI_LANGUAGE 跑完才存在,而本文件比它更早被 include。
;
; ⚠ 串里的上限用 ${M2W_PATH_MAX}(编译期展开成字面量 8191),**不是**
; $M2W_PATH_MAX。M2W_PATH_MAX 是 !define 而不是 Var,单 $ 引用在运行期
; 展开为空,用户会看到 "over  characters" 这种漏了数字的话 —— 而且编译期
; 还会报 warning 6000 "unknown variable/constant"。$INSTDIR 是真的 Var,
; 单 $ 是对的,别一起改掉。
!insertmacro M2W_LangString "M2W_PATH_TOOLONG" \
  "用户 PATH 过长(超过 ${M2W_PATH_MAX} 个字符),已跳过写入以免损坏现有 PATH。安装目录未被添加,需要时请手动把它加进用户 PATH:$INSTDIR" \
  "Your user PATH is too long (over ${M2W_PATH_MAX} characters), so it was left untouched rather than risking damage to it. The install folder was not added; add it to your user PATH by hand if you need it:$INSTDIR"

!insertmacro M2W_LangString "M2W_PATH_HEADER" "命令行入口" "Command-line entry"
!insertmacro M2W_LangString "M2W_PATH_SUBHEADER" "选择是否把安装目录加入 PATH" "Choose whether to add the install folder to PATH"
!insertmacro M2W_LangString "M2W_PATH_EXPLAIN" \
  "勾选后可直接在终端输入 m2w 调用本工具。只会追加到您自己的用户 PATH,卸载时自动还原。" \
  "When checked, you can run m2w directly in a terminal. It is appended to your own user PATH and restored on uninstall."
!insertmacro M2W_LangString "M2W_PATH_OPTIN" \
  "把安装目录添加到用户 PATH(默认不勾选;勾选后需重开终端才生效)" \
  "Add the install folder to my user PATH (off by default; reopen your terminal afterwards for it to take effect)"

; 勾选页的三个 Var 只被 installer-only 的那一段用到(customPageAfterChangeDir 与
; customInstall 都在 !ifndef BUILD_UNINSTALLER 里),所以守卫起来 —— 否则卸载器那趟
; 会报 "warning 6001: Variable \"M2W_Page\" not referenced or never set"。
!ifndef BUILD_UNINSTALLER
  Var M2W_Page
  Var M2W_CheckBox
  Var M2W_AddToPath
!endif

; ----------------------------------------------------------------------------
;  Consent page (installer only; this macro is not reached for the uninstaller).
;
;  WHY the page functions are declared INSIDE this macro instead of at file
;  scope — do not "tidy" them back out, it breaks the real build:
;  electron-builder prepends this file to installer.nsi, and installer.nsi is
;  what does `!include "MUI2.nsh"`. So while this file is being parsed, not one
;  MUI2 macro exists yet. A `!insertmacro` in a top-level Function body is
;  resolved eagerly, right there — which is why the build used to die with
;  '!insertmacro: macro named "MUI_PAGE_FUNCTION_CUSTOM" not found' on the
;  first MUI2 macro reached (and would equally have died on MUI_HEADER_TEXT
;  next). The same `!insertmacro` inside a macro body is resolved lazily, when
;  the macro is inserted — which happens from assistedInstaller.nsh, long
;  after MUI2 is in. That asymmetry is the whole bug; it also explains why
;  MUI_PAGE_INIT a few lines up never failed: it sits in a macro body.
;  (Declaring a Function inside a macro is legal and is exactly what MUI2's own
;  MUI_PAGEDECLARATION_* macros do.)
;
;  WHY there is deliberately no `MUI_PAGE_FUNCTION_CUSTOM` here — it is removed
;  on purpose, not merely because it failed to compile: that macro is MUI2's
;  *user-hook* dispatcher for its OWN built-in pages. `PageEx custom` gets no
;  MUI2 wrapper at all — NSIS invokes our callbacks directly, so the hook
;  would be dead code. Worse, it is actively destructive: the macro ends in
;  `!undef MUI_PAGE_CUSTOMFUNCTION_${TYPE}`, and electron-builder sets
;  `MUI_PAGE_CUSTOMFUNCTION_PRE instFilesPre` (assistedInstaller.nsh:30) for
;  MUI_PAGE_INSTFILES, which is inserted *after* this page. Emitting the hook
;  here would Call instFilesPre early and undefine it, so the $INSTDIR
;  APP_FILENAME sanitisation would silently stop happening — a silent install
;  regression that no compile error would ever point at.
;  `MUI_HEADER_TEXT` is the right macro for a custom page's header: it is
;  self-contained (just two WM_SETTEXTs against $mui.Header.*, which
;  MUI_PAGE_INIT -> MUI_INTERFACE populates) and touches no hook symbols.
;
;  Declaration order below (page, then its functions) mirrors MUI2's own
;  MUI_PAGEDECLARATION_* macros.
; ----------------------------------------------------------------------------
!macro customPageAfterChangeDir
  !insertmacro MUI_PAGE_INIT

  PageEx custom
    PageCallbacks m2w.PathPageCreate m2w.PathPageLeave
  PageExEnd

  Function m2w.PathPageCreate
    nsDialogs::Create 1018
    Pop $M2W_Page

    !insertmacro MUI_HEADER_TEXT "$(M2W_PATH_HEADER)" "$(M2W_PATH_SUBHEADER)"

    ${NSD_CreateLabel} 0u 8u 300u 32u "$(M2W_PATH_EXPLAIN)"
    ; Handle kept in a Var, not a register: the leave callback is a separate
    ; invocation and $0 does not survive into it.
    ${NSD_CreateCheckBox} 0u 46u 300u 20u "$(M2W_PATH_OPTIN)"
    Pop $M2W_CheckBox

    nsDialogs::Show
  FunctionEnd

  Function m2w.PathPageLeave
    ; "" (page never ran, e.g. /S) and "0" (left alone) both mean "leave PATH be".
    SendMessage $M2W_CheckBox ${BM_GETCHECK} 0 0 $M2W_AddToPath
  FunctionEnd
!macroend

; ----------------------------------------------------------------------------
;  Apply / restore.
; ----------------------------------------------------------------------------
!macro customInstall
  ${If} $M2W_AddToPath == "1"
    Call m2w.ApplyPath
  ${EndIf}
!macroend

!macro customUnInstall
  Call ${M2W_RESTORE_FN}
!macroend

; 广播环境变更。不广播的话 Explorer 会继续派发旧 PATH,装完新开的终端仍看不到
; 这一项 —— 勾选框看起来像坏了,用户会以为安装失败。装与卸两处都要发。
!macro M2W_BroadcastEnv
  System::Call "shell32::SendMessage(i 0xffff, i 0x1a, i 0, t 'Environment')"
!macroend

; 把安装目录追加到用户 PATH。
;
; !ifndef BUILD_UNINSTALLER 是必需的,不是洁癖:本文件被 electron-builder 同时
; 编进**安装器与卸载器两趟**(同一份 sharedHeader),而 customInstall 只在安装器
; 那趟被 insert(installSection.nsh 被 installer.nsi 用 !ifndef BUILD_UNINSTALLER
; 包着)。于是在卸载器那趟,本函数没有任何 Call —— NSIS 报
; "warning 6010: install function ... not referenced - zeroing code out",
; 而 electron-builder --warnings-as-errors 直接让它失败。同理 un.m2w.RestorePath
; 只在卸载器那趟被 customUnInstall 调用,故它用 !ifdef 包住。
; 顺带的好处:卸载器二进制里不再塞一份永不执行的安装期逻辑。
;
; BUILD_UNINSTALLER 是命令行 define(日志里 "Command line defined:
; \"BUILD_UNINSTALLER\""),从脚本第一行起就可见,所以这个守卫在文件顶部可用。
!ifndef BUILD_UNINSTALLER
Function m2w.ApplyPath
  ReadRegStr $0 HKCU "Environment" "Path"

  ; 记过账:上一次运行已经追加过了,不能再追加第二份。
  ReadRegStr $1 HKCU "${M2W_LEDGER_KEY}" "${M2W_WRITTEN}"
  ${If} $1 != ""
    Return
  ${EndIf}

  ; 已在 PATH 里但没有我们的记录 —— 用户(或别的什么)自己加的。再追加会多一份,
  ; 而认领它会让卸载删掉一条我们从没加过的、属于用户的条目。什么都不做。
  ; 两端补 ';' 再整段匹配:不补的话首项/末项匹配不到,而且
  ; "...\MarkdownToWord" 会误配 "...\MarkdownToWord-old"。
  ${StrStr} $2 ";$0;" ";$INSTDIR;"
  ${If} $2 != ""
    Return
  ${EndIf}

  ; 追加,原样保留已有内容(含 ;;; 空项)。
  ${If} $0 == ""
    StrCpy $3 "$INSTDIR"
  ${Else}
    StrCpy $3 "$0;$INSTDIR"
  ${EndIf}

  ; 太长就不写,并把原因告诉用户(静默跳过最坏:用户以为勾了没生效)。
  ; /S 下不能弹窗 —— 自动化安装会被 MessageBox 卡死,故只记安装日志;
  ; check:install-smoke 会把安装器输出收进失败日志,那里仍看得见。
  StrLen $4 $3
  ${If} $4 > ${M2W_PATH_MAX}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "$(M2W_PATH_TOOLONG)"
    ${EndIf}
    DetailPrint "[m2w] 用户 PATH 超长($4 > ${M2W_PATH_MAX}),已跳过写入;安装目录:$INSTDIR"
    Return
  ${EndIf}

  ; 始终用 WriteRegExpandStr,不做类型探测。
  ;
  ; 为什么不探测:HKCU\Environment 的 PATH 默认就是 REG_EXPAND_SZ,而
  ; REG_EXPAND_SZ 是 REG_SZ 的超集 —— 纯路径写进去没有任何展开副作用。反过来,
  ; 若探测到 REG_SZ 就照 REG_SZ 写回去,则用户原有的 %USERPROFILE%/%SystemRoot%
  ; 会**停止展开**,那是把用户环境改坏,比长度问题严重得多。方向是单向安全的:
  ; 永远写 EXPAND_SZ 最多是"多写了类型",绝不会"少写了展开"。
  ; 探测反而会引入「探测失败时往哪边落」的分支,而那个分支的失败模式正是上面
  ; 那个严重的。所以后来人若觉得"探测一下更稳",请先重读这一段。
  ;
  ; $3 已含旧值,故这是追加而非覆盖。
  WriteRegExpandStr HKCU "Environment" "Path" "$3"
  WriteRegStr HKCU "${M2W_LEDGER_KEY}" "${M2W_BEFORE}" "$0"
  WriteRegStr HKCU "${M2W_LEDGER_KEY}" "${M2W_WRITTEN}" "$3"

  !insertmacro M2W_BroadcastEnv
FunctionEnd
!endif ; !ifndef BUILD_UNINSTALLER

; 还原 PATH,但只在我们写的那个值原封不动地还在时才动。
;
; ⚠ 未经编译验证的部分:NSIS 对 `Call` 的目标**不做存在性检查**(实测:改成
; 不存在的函数名仍编译通过),所以「本函数确实被调用到」只能靠真卸载验证,
; 编译期只能保证语法与函数体本身编得过。已用 M2W_RESTORE_FN 单源化函数名,
; 把「Call 与定义写歪」这一类错误变成不可能;剩下的只有"有人删掉了函数体
; 却留下 Call",那属于改坏安装器,真卸载会当场报出来。
;
; 另注:本函数刻意不用 StrFunc —— ${StrStr} 展开的是 `Call StrStr`(非 un. 前缀),
; 放进 un. 段会被 NSIS 编译期拒绝("Call must be used with function names
; starting with un. in the uninstall section",实测)。要用字符串函数得改用
; 其它手段,别顺手加一行 ${StrStr} 进来。
;
; !ifdef BUILD_UNINSTALLER:与上面 ApplyPath 的 !ifndef 同一理由,只是方向相反 ——
; 本函数只被 customUnInstall 调用,而它只在卸载器那趟被 insert
; (uninstaller.nsh 被 installer.nsi 用 !ifdef BUILD_UNINSTALLER 包着)。少了这个
; 守卫,安装器那趟就会因「引用不到」而 warning 6010 失败。
!ifdef BUILD_UNINSTALLER
Function ${M2W_RESTORE_FN}
  ReadRegStr $0 HKCU "Environment" "Path"
  ReadRegStr $1 HKCU "${M2W_LEDGER_KEY}" "${M2W_WRITTEN}"
  ReadRegStr $2 HKCU "${M2W_LEDGER_KEY}" "${M2W_BEFORE}"

  ; 从没勾选过,没有我们的东西要撤。
  ${If} $1 == ""
    Return
  ${EndIf}

  ; 用户在装完之后改过 PATH。此刻用户的值才是真的 —— 唯一安全的动作是删掉自己
  ; 的账本,一个字都不碰用户的文本。
  ${If} $0 != $1
    Goto dropRecords
  ${EndIf}

  ; 是我们写的、且没被动过:精确还原成 before。原值为空(键原本不存在或为空)
  ; 就删键,那才是忠实的逆操作。
  ; 同样用 WriteRegExpandStr:还原时若写成 REG_SZ,会把用户原有的 %VAR% 弄失效,
  ; 那正是安装时特意避免的那种改坏。
  ${If} $2 == ""
    DeleteRegValue HKCU "Environment" "Path"
  ${Else}
    WriteRegExpandStr HKCU "Environment" "Path" "$2"
  ${EndIf}

  dropRecords:
  DeleteRegValue HKCU "${M2W_LEDGER_KEY}" "${M2W_BEFORE}"
  DeleteRegValue HKCU "${M2W_LEDGER_KEY}" "${M2W_WRITTEN}"

  !insertmacro M2W_BroadcastEnv
FunctionEnd
!endif ; !ifdef BUILD_UNINSTALLER
