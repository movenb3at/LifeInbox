from pathlib import Path

from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.execute(Path(__file__).with_suffix(".sql").read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("자동화 원본·기록을 보존하기 위해 자동 downgrade를 제공하지 않습니다.")
