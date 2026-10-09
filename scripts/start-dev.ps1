$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apiDirectory = Join-Path $projectRoot 'apps/api'
$logDirectory = Join-Path $projectRoot '.local'
# 일반 터미널에 개발 도구가 없으면 이 PC의 Codex 내장 런타임을 사용합니다.
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $runtimeDirectory = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
    $runtimePaths = @('node/bin', 'bin/fallback') | ForEach-Object { Join-Path $runtimeDirectory $_ } | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
    if ($runtimePaths) { $env:Path = ($runtimePaths -join ';') + ';' + $env:Path }
}
foreach ($requiredTool in @('node', 'pnpm', 'uv')) {
    if (-not (Get-Command $requiredTool -ErrorAction SilentlyContinue)) {
        throw "$requiredTool 명령을 찾을 수 없습니다. README의 필요한 도구를 설치하거나 Codex 런타임을 확인해주세요."
    }
}
function Stop-ApiProcess($process) {
    if (-not $process -or $process.HasExited) { return }
    # Windows 가상환경 실행기는 실제 Python 서버를 자식 프로세스로 실행할 수 있습니다.
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.Id)" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -match 'uvicorn app.main:app|app.automation.scheduler.worker' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
}
$env:UV_CACHE_DIR = Join-Path $logDirectory 'uv-cache'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Push-Location $apiDirectory
try {
    uv sync --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Python 의존성 설치에 실패했습니다.' }
} finally { Pop-Location }
foreach ($serverPort in @(3000, 8000)) {
    if (Get-NetTCPConnection -LocalPort $serverPort -State Listen -ErrorAction SilentlyContinue) {
        throw "$serverPort 번 포트가 사용 중입니다. 기존 서버를 확인해주세요."
    }
}
$apiProcess = Start-Process -FilePath (Join-Path $apiDirectory '.venv/Scripts/python.exe') -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $apiDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'api.log') -RedirectStandardError (Join-Path $logDirectory 'api-error.log')
$workerProcess = Start-Process -FilePath (Join-Path $apiDirectory '.venv/Scripts/python.exe') -ArgumentList @('-m','app.automation.scheduler.worker') -WorkingDirectory $apiDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'worker.log') -RedirectStandardError (Join-Path $logDirectory 'worker-error.log')
Push-Location $projectRoot
try {
    Write-Host 'LifeInbox: http://localhost:3000 / API: http://127.0.0.1:8000/docs'
    pnpm dev
    if ($LASTEXITCODE -ne 0) { throw '웹 서버 실행에 실패했습니다.' }
} finally {
    Pop-Location
    Stop-ApiProcess $workerProcess
    Stop-ApiProcess $apiProcess
}
