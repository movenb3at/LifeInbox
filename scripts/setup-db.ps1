$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apiDirectory = Join-Path $projectRoot 'apps/api'
$env:UV_CACHE_DIR = Join-Path $projectRoot '.local/uv-cache'
if (-not (Test-Path -LiteralPath (Join-Path $apiDirectory '.env'))) {
    throw 'apps/api/.env.example을 .env로 복사하고 Supabase 연결값을 설정해주세요.'
}
Push-Location $apiDirectory
try {
    uv sync --frozen
    if ($LASTEXITCODE -ne 0) { throw 'Python 의존성 설치에 실패했습니다.' }
    uv run --frozen alembic upgrade head
    if ($LASTEXITCODE -ne 0) { throw 'DB 마이그레이션에 실패했습니다.' }
    uv run --frozen python ../../scripts/provision_db.py
    if ($LASTEXITCODE -ne 0) { throw '앱 실행 계정 설정에 실패했습니다.' }
} finally { Pop-Location }
