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
!macro M2W_EnsureStrFunc
  !ifndef StrStr_INCLUDED
    ${StrStr}
  !endif
!macroend

!insertmacro M2W_EnsureStrFunc

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
!define M2W_BEFORE "M2WPathBefore"
!define M2W_WRITTEN "M2WPathWritten"

; 写入 PATH 的长度上限(字符)。超过就不写。
;
; 取值依据:环境块(用户变量 + 系统变量合计)的硬上限是 32767 字符,超了
; CreateProcess 会失败。8191 远高于任何正常单条 PATH,又给其余变量留足余量。
; 之所以**宁可放弃也不截断**:截断会直接毁掉用户剩下的整条 PATH,那比没写
; 坏得多;放弃只让这一次勾选不生效,且下面会把原因告诉用户。
!define M2W_PATH_MAX 8191

; 超长而放弃写入时给用户看的话。不能只写日志 —— 静默跳过的话,用户的判断是
; 「我勾了但没生效」,而真实原因是长度,两边对不上,下次还会遇到。
LangString M2W_PATH_TOOLONG 2052 "用户 PATH 过长(超过 $M2W_PATH_MAX 个字符),已跳过写入以免损坏现有 PATH。安装目录未被添加,需要时请手动把它加进用户 PATH:$INSTDIR"
LangString M2W_PATH_TOOLONG 1033 "Your user PATH is too long (over $M2W_PATH_MAX characters), so it was left untouched rather than risking damage to it. The install folder was not added; add it to your user PATH by hand if you need it:$INSTDIR"

; 声明在这里而不是复用 electron-builder 的 $(...) 串:那些来自工具自带的
; messages yml,本仓不该改它。LCID 用数字(2052 zh-CN / 1033 en-US,与
; build.win.electronLanguages 一致),因为 LANG_* 符号要等 MUI_LANGUAGE 跑完
; 才存在,而本文件比它更早被 include。electronLanguages 变了就照着加一行。
LangString M2W_PATH_HEADER 2052 "命令行入口"
LangString M2W_PATH_HEADER 1033 "Command-line entry"
LangString M2W_PATH_SUBHEADER 2052 "选择是否把安装目录加入 PATH"
LangString M2W_PATH_SUBHEADER 1033 "Choose whether to add the install folder to PATH"
LangString M2W_PATH_EXPLAIN 2052 "勾选后可直接在终端输入 m2w 调用本工具。只会追加到您自己的用户 PATH,卸载时自动还原。"
LangString M2W_PATH_EXPLAIN 1033 "When checked, you can run m2w directly in a terminal. It is appended to your own user PATH and restored on uninstall."
LangString M2W_PATH_OPTIN 2052 "把安装目录添加到用户 PATH(默认不勾选;勾选后需重开终端才生效)"
LangString M2W_PATH_OPTIN 1033 "Add the install folder to my user PATH (off by default; reopen your terminal afterwards for it to take effect)"

Var M2W_Page
Var M2W_CheckBox
Var M2W_AddToPath

; ----------------------------------------------------------------------------
;  Consent page (installer only; this macro is not reached for the uninstaller).
; ----------------------------------------------------------------------------
!macro customPageAfterChangeDir
  !insertmacro MUI_PAGE_INIT

  PageEx custom
    PageCallbacks m2w.PathPageCreate m2w.PathPageLeave
  PageExEnd
!macroend

Function m2w.PathPageCreate
  !insertmacro MUI_PAGE_FUNCTION_CUSTOM PRE
  nsDialogs::Create 1018
  Pop $M2W_Page

  !insertmacro MUI_HEADER_TEXT "$(M2W_PATH_HEADER)" "$(M2W_PATH_SUBHEADER)"

  ${NSD_CreateLabel} 0u 8u 300u 32u "$(M2W_PATH_EXPLAIN)"
  ; Handle kept in a Var, not a register: the leave callback is a separate
  ; invocation and $0 does not survive into it.
  ${NSD_CreateCheckBox} 0u 46u 300u 20u "$(M2W_PATH_OPTIN)"
  Pop $M2W_CheckBox

  !insertmacro MUI_PAGE_FUNCTION_CUSTOM SHOW
  nsDialogs::Show
FunctionEnd

Function m2w.PathPageLeave
  ; "" (page never ran, e.g. /S) and "0" (left alone) both mean "leave PATH be".
  SendMessage $M2W_CheckBox ${BM_GETCHECK} 0 0 $M2W_AddToPath
FunctionEnd

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
Function m2w.ApplyPath
  ReadRegStr $0 HKCU "Environment" "Path"

  ; 记过账:上一次运行已经追加过了,不能再追加第二份。
  ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" "${M2W_WRITTEN}"
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
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "${M2W_BEFORE}" "$0"
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" "${M2W_WRITTEN}" "$3"

  !insertmacro M2W_BroadcastEnv
FunctionEnd

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
Function ${M2W_RESTORE_FN}
  ReadRegStr $0 HKCU "Environment" "Path"
  ReadRegStr $1 HKCU "${INSTALL_REGISTRY_KEY}" "${M2W_WRITTEN}"
  ReadRegStr $2 HKCU "${INSTALL_REGISTRY_KEY}" "${M2W_BEFORE}"

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
  DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" "${M2W_BEFORE}"
  DeleteRegValue HKCU "${INSTALL_REGISTRY_KEY}" "${M2W_WRITTEN}"

  !insertmacro M2W_BroadcastEnv
FunctionEnd
