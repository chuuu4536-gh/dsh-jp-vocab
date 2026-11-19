# 注册 Native Messaging 宿主（Edge + Chrome 各一份，值相同）
# 用法：powershell -ExecutionPolicy Bypass -File install.ps1
# 卸载：powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $here 'manifest.json'
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$hostName = $manifest.name

if ($Uninstall) {
    foreach ($app in @('Microsoft\Edge', 'Google\Chrome')) {
        $key = "HKCU:\Software\$app\NativeMessagingHosts\$hostName"
        if (Test-Path $key) { Remove-Item $key -Recurse -Force; Write-Host "已移除：$key" }
    }
    exit 0
}

# --- 前置准备：路径文件与启动器（首次运行自动生成） ---
$nodePathFile = Join-Path $here 'node-path.txt'
$scriptPathFile = Join-Path $here 'script-path.txt'

if (-not (Test-Path $nodePathFile)) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $guess = if ($nodeCmd) { $nodeCmd.Source } else { '' }
    if (-not $guess) { throw '找不到 node，请手动创建 node-path.txt 并写入 node.exe 的绝对路径' }
    Set-Content -Path $nodePathFile -Value $guess -NoNewline -Encoding UTF8
    Write-Host "已写入 node 路径：$guess"
}
if (-not (Test-Path $scriptPathFile)) {
    Set-Content -Path $scriptPathFile -Value (Join-Path $here 'host.js') -NoNewline -Encoding UTF8
    Write-Host '已写入 host.js 路径'
}

$exePath = Join-Path $here 'host.exe'
if (-not (Test-Path $exePath)) {
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (Test-Path $csc) {
        & $csc /nologo /target:exe "/out:$exePath" (Join-Path $here 'launcher.cs') | Out-Null
        if (Test-Path $exePath) { Write-Host '已编译 host.exe' } else { throw 'host.exe 编译失败' }
    } else {
        throw '缺少 host.exe 且找不到 csc.exe，请手动编译：csc /nologo /target:exe /out:host.exe launcher.cs'
    }
}

# --- 前置检查 ---
if (-not (Test-Path $manifestPath)) { throw "找不到 $manifestPath" }
if (-not (Test-Path $manifest.path)) {
    throw "manifest 指向的 $($manifest.path) 不存在，请重新运行本脚本以生成 host.exe"
}
foreach ($f in @('node-path.txt', 'script-path.txt', 'host.js')) {
    if (-not (Test-Path (Join-Path $here $f))) { throw "缺少 $f" }
}
$nodePath = (Get-Content (Join-Path $here 'node-path.txt') -Raw).Trim()
if (-not (Test-Path $nodePath)) { throw "node-path.txt 里的 node 不存在：$nodePath" }

# --- 首次运行生成默认配置 ---
$cfgHome = Join-Path $env:USERPROFILE '.jp-vocab'
$cfg = Join-Path $cfgHome 'config.json'
if (-not (Test-Path $cfg)) {
    try {
        New-Item -ItemType Directory -Force -Path $cfgHome | Out-Null
        @{
            vocabDir     = 'D:\DSH\Plugin\jp-vocab\vocab'
            summariesDir = 'D:\DSH\Plugin\jp-vocab\summaries'
            timeZone     = 'Asia/Shanghai'
        } | ConvertTo-Json | Set-Content -Encoding UTF8 $cfg
        Write-Host "已创建默认配置：$cfg"
    } catch {
        Write-Host "跳过配置创建（$cfgHome 不可写，宿主会退回内置默认值）：$($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# --- 写注册表 ---
foreach ($app in @('Microsoft\Edge', 'Google\Chrome')) {
    $key = "HKCU:\Software\$app\NativeMessagingHosts\$hostName"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name '(default)' -Value $manifestPath
    Write-Host "已注册：$key -> $manifestPath"
}

Write-Host ''
Write-Host '自检：'
& (Join-Path $here 'verify.ps1')
