# 自检：manifest / 可执行文件 / 注册表 / 协议 ping
# 用法：powershell -ExecutionPolicy Bypass -File verify.ps1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ok = 0
$bad = 0

function Pass($msg) { Write-Host "  [OK]   $msg" -ForegroundColor Green; $script:ok++ }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:bad++ }

Write-Host "== 1. manifest =="
$manifestPath = Join-Path $here 'manifest.json'
if (-not (Test-Path $manifestPath)) { Fail "缺少 $manifestPath"; exit 1 }
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Pass "name = $($manifest.name)"
Pass "type = $($manifest.type)"

Write-Host "== 2. 宿主可执行文件 =="
$exe = $manifest.path
if (Test-Path $exe) { Pass "存在：$exe" } else { Fail "不存在：$exe（需先编译 host.exe）" }
foreach ($f in @('node-path.txt', 'script-path.txt', 'host.js', 'lib\core.js')) {
    $p = Join-Path $here $f
    if (Test-Path $p) { Pass "存在：$f" } else { Fail "缺少：$p" }
}
$nodePath = Get-Content (Join-Path $here 'node-path.txt') -Raw
$nodePath = $nodePath.Trim()
if (Test-Path $nodePath) { Pass "node 存在：$nodePath" } else { Fail "node 不存在：$nodePath" }

Write-Host "== 3. 注册表 =="
foreach ($app in @('Microsoft\Edge', 'Google\Chrome')) {
    $key = "HKCU:\Software\$app\NativeMessagingHosts\$($manifest.name)"
    if (Test-Path $key) {
        $v = (Get-ItemProperty $key).'(default)'
        if ($v -eq $manifestPath) { Pass "$app -> $v" } else { Fail "$app 指向 $v（应为 $manifestPath）" }
    } else {
        Fail "$app 未注册（运行 install.ps1）"
    }
}

Write-Host "== 4. 协议 ping =="
function Test-Ping($exePath) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exePath
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $payload = [System.Text.Encoding]::UTF8.GetBytes('{"type":"ping"}')
    $frame = New-Object byte[] (4 + $payload.Length)
    [Array]::Copy([BitConverter]::GetBytes([int]$payload.Length), 0, $frame, 0, 4)
    [Array]::Copy($payload, 0, $frame, 4, $payload.Length)
    $p.StandardInput.BaseStream.Write($frame, 0, $frame.Length)
    $p.StandardInput.BaseStream.Flush()
    $p.StandardInput.Close()
    $stream = $p.StandardOutput.BaseStream
    $head = New-Object byte[] 4
    $read = 0
    while ($read -lt 4) { $n = $stream.Read($head, $read, 4 - $read); if ($n -le 0) { break }; $read += $n }
    if ($read -lt 4) { return $null }
    $size = [BitConverter]::ToInt32($head, 0)
    $buf = New-Object byte[] $size
    $read = 0
    while ($read -lt $size) { $n = $stream.Read($buf, $read, $size - $read); if ($n -le 0) { break }; $read += $n }
    $p.WaitForExit(3000) | Out-Null
    return [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
}

try {
    $reply = Test-Ping $exe
    if ($reply) { Pass "ping 返回：$reply" } else { Fail 'ping 无响应' }
} catch {
    Fail "ping 异常：$($_.Exception.Message)"
}

Write-Host ''
if ($bad -eq 0) {
    Write-Host "全部通过（$ok 项）。下一步：在 Edge 里加载扩展，打开设置页点『测试本地宿主』。" -ForegroundColor Green
} else {
    Write-Host "有 $bad 项失败，按上面的提示修。" -ForegroundColor Yellow
    exit 1
}
