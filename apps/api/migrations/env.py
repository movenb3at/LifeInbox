import os
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine, pool, text

from app.models import Base

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
url = os.environ.get("MIGRATION_DATABASE_URL", "")
if not url:
    raise RuntimeError("MIGRATION_DATABASE_URL 환경변수가 필요합니다.")

if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True,
                      dialect_opts={"paramstyle": "named"}, version_table_schema="app_migrations")
    with context.begin_transaction():
        context.execute("CREATE SCHEMA IF NOT EXISTS app_migrations")
        context.execute("REVOKE ALL ON SCHEMA app_migrations FROM PUBLIC")
        context.run_migrations()
        context.execute("ALTER TABLE app_migrations.alembic_version ENABLE ROW LEVEL SECURITY")
else:
    engine = create_engine(url, poolclass=pool.NullPool, connect_args={"prepare_threshold": None})
    with engine.connect() as connection:
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS app_migrations"))
        connection.execute(text("REVOKE ALL ON SCHEMA app_migrations FROM PUBLIC"))
        connection.commit()
        context.configure(connection=connection, target_metadata=Base.metadata, version_table_schema="app_migrations")
        with context.begin_transaction():
            context.run_migrations()
            connection.execute(text("ALTER TABLE app_migrations.alembic_version ENABLE ROW LEVEL SECURITY"))
