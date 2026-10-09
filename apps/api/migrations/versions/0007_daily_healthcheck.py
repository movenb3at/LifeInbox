from pathlib import Path

from alembic import op

revision = "0007"
down_revision = "0006"


def upgrade():
    op.execute(Path(__file__).with_suffix(".sql").read_text(encoding="utf-8"))


def downgrade():
    op.execute("DROP FUNCTION public.lifeinbox_healthcheck()")
    op.execute("NOTIFY pgrst, 'reload schema'")
