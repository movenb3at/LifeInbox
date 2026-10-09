$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:UV_CACHE_DIR = Join-Path $projectRoot '.local/uv-cache'
New-Item -ItemType Directory -Path (Join-Path $projectRoot '.local') -Force | Out-Null
function Assert-Exit { if ($LASTEXITCODE -ne 0) { throw '검증 명령에 실패했습니다.' } }
Push-Location (Join-Path $projectRoot 'apps/api')
try {
    uv sync --frozen
    Assert-Exit
    uv run --frozen ruff check app migrations tests ../../scripts
    Assert-Exit
    uv run --frozen pytest
    Assert-Exit
    uv run --frozen python ../../scripts/export_openapi.py
    Assert-Exit
    $taskMigrationUrl = $env:MIGRATION_DATABASE_URL
    try {
        $env:MIGRATION_DATABASE_URL = 'postgresql+psycopg://test:test@localhost/test'
        uv run --frozen python ../../scripts/export_migrations.py
        Assert-Exit
    } finally { $env:MIGRATION_DATABASE_URL = $taskMigrationUrl }
} finally { Pop-Location }
Push-Location $projectRoot
try {
    pnpm generate:api
    Assert-Exit
    pnpm typecheck
    Assert-Exit
    pnpm lint
    Assert-Exit
    node scripts/test-db.mjs
    Assert-Exit
    node scripts/test-space-migration.mjs .local/alembic-head.sql
    Assert-Exit
    pnpm test:e2e
    Assert-Exit
    pnpm build
    Assert-Exit
} finally { Pop-Location }
