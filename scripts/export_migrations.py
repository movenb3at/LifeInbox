"""검증용 마이그레이션 SQL을 PowerShell 인코딩 변환 없이 저장합니다."""
from io import StringIO
from pathlib import Path

from alembic import command
from alembic.config import Config

root = Path(__file__).resolve().parents[1]
output = StringIO()
config = Config(str(root / "apps/api/alembic.ini"), output_buffer=output)
command.upgrade(config, "head", sql=True)
destination = root / ".local/alembic-head.sql"
destination.parent.mkdir(exist_ok=True)
destination.write_text(output.getvalue(), encoding="utf-8")
print("Migration SQL exported to .local/alembic-head.sql")
