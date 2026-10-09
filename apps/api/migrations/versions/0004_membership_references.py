from pathlib import Path

from alembic import op

revision = "0004"
down_revision = "0003"


def upgrade():
    op.execute(Path(__file__).with_suffix(".sql").read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("안전한 멤버 제거 정책을 유지하기 위해 자동 downgrade하지 않습니다.")
