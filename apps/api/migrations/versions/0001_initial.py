from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None


def upgrade():
    sql = Path(__file__).with_suffix(".sql").read_text(encoding="utf-8")
    op.execute(sql)


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS lifeinbox_signup ON auth.users")
    op.execute("DROP FUNCTION IF EXISTS app.handle_signup()")
    op.execute("DROP SCHEMA app CASCADE")
