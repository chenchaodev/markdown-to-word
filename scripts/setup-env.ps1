# 一次性设置 Electron 镜像为用户级环境变量（本地开发用，GitHub Actions 不需要）
#
# 用法（PowerShell）：
#   powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1
#
# 说明：
# - 不要在根 .npmrc 写 electron_mirror / electron_builder_binaries_mirror：
#   npm 不识别会报 "Unknown config" 警告，且 electron-builder 读不到该键会回退 GitHub 下载。
# - 这里用真实环境变量 ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR，
#   electron 安装脚本与 electron-builder 都能正确读取，且无 npm 警告。
# - 写入 User 级，重启终端/新进程自动继承；当前进程也临时生效。

$electronMirror = 'https://npmmirror.com/mirrors/electron/'
$builderMirror = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

[Environment]::SetEnvironmentVariable('ELECTRON_MIRROR', $electronMirror, 'User')
[Environment]::SetEnvironmentVariable('ELECTRON_BUILDER_BINARIES_MIRROR', $builderMirror, 'User')

# 当前会话立即生效（新开的终端会从 User 级继承）
$env:ELECTRON_MIRROR = $electronMirror
$env:ELECTRON_BUILDER_BINARIES_MIRROR = $builderMirror

Write-Host "已写入用户级环境变量："
Write-Host "  ELECTRON_MIRROR=$electronMirror"
Write-Host "  ELECTRON_BUILDER_BINARIES_MIRROR=$builderMirror"
Write-Host "新开的终端 / 进程将自动继承；当前进程已临时生效。"
