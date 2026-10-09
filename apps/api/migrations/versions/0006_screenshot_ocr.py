from pathlib import Path

from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade():
    op.execute(Path(__file__).with_suffix(".sql").read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("스크린샷 원본과 OCR 기록을 보존하기 위해 자동 downgrade하지 않습니다.")
