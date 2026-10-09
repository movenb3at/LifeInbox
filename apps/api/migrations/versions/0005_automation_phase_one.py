from pathlib import Path

from alembic import op

revision = "0005"
down_revision = "0004"


def upgrade():
    op.execute(Path(__file__).with_suffix(".sql").read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("여러 후보와 기존 분석 기록을 보존하기 위해 자동 downgrade하지 않습니다.")
