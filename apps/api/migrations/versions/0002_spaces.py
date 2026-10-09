from pathlib import Path

from alembic import op

revision = "0002"
down_revision = "0001"


def upgrade():
    op.execute(Path(__file__).with_suffix(".sql").read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("여러 Personal Space를 보존하기 위해 단일 Inbox로 자동 downgrade하지 않습니다.")
