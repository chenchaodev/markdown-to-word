@echo off
rem ============================================================================
rem  MarkdownToWord - installed CLI entry
rem ----------------------------------------------------------------------------
rem  Why a forwarder instead of shipping node: the installed app exe already has
rem  Electron's RunAsNode fuse on, so ELECTRON_RUN_AS_NODE=1 turns it into a plain
rem  node runtime. No second runtime, no bundler, no SEA.
rem
rem  Why the entry script stays inside app.asar: asar is fully transparent to fs
rem  in this mode (documented + measured), so the code needs no asarUnpack and no
rem  change to build.files / the asar top-level manifest. Only this launcher has
rem  to sit outside the archive - which is exactly what it is.
rem
rem  Where this launcher sits: the **install root**, next to MarkdownToWord.exe -
rem  landed there by build.extraFiles (NOT extraResources, which would drop it in
rem  resources\ next to app.asar and one level deeper than a user looks). That is
rem  why the exe is %~dp0MarkdownToWord.exe (same dir) while the archive is
rem  %~dp0resources\app.asar\... (one level down). Both paths are quoted: install
rem  paths contain spaces as a matter of course.
rem
rem  Why no setlocal: this process deliberately does NOT isolate the environment.
rem  ELECTRON_RUN_AS_NODE would otherwise be invisible to the rest of the chain,
rem  and the child host process would silently inherit it (src/cli/host-launch.ts
rem  hostEnv() is the single place that strips it).
rem
rem  M2W_ENTRY selects the script inside the archive. Default is the CLI.
rem  MCP clients override it (see docs/MCP.md), e.g. M2W_ENTRY=dist\mcp\index.js
rem ============================================================================

if not defined M2W_ENTRY set "M2W_ENTRY=dist\cli\index.js"

set "ELECTRON_RUN_AS_NODE=1"

rem stdout/stderr and the exit code must pass through byte for byte: the MCP
rem transport is line-framed JSON-RPC, so one extra byte or a swallowed exit
rem code breaks the protocol. Hence @echo off above and exit /b below.
"%~dp0MarkdownToWord.exe" "%~dp0resources\app.asar\%M2W_ENTRY%" %*
exit /b %ERRORLEVEL%
