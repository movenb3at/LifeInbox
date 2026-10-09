import secrets
from pathlib import Path

import psycopg
from dotenv import dotenv_values, set_key
from psycopg import sql
from sqlalchemy.engine import make_url

env_path = Path(__file__).resolve().parents[1] / "apps/api/.env"
values = dotenv_values(env_path)
admin = make_url(values.get("MIGRATION_DATABASE_URL", ""))
if not admin.host or "POOLER_HOST" in admin.host or "PASSWORD" in (admin.password or ""):
    raise SystemExit("먼저 apps/api/.env의 관리자 DB 연결값을 설정해주세요.")
password = secrets.token_urlsafe(32)
admin_conn = admin.set(drivername="postgresql").render_as_string(hide_password=False)
with psycopg.connect(admin_conn, prepare_threshold=None) as connection:
    connection.execute(sql.SQL("ALTER ROLE lifeinbox_app PASSWORD {}").format(sql.Literal(password)))
    safe = connection.execute("""
        SELECT NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolinherit)
        FROM pg_roles WHERE rolname='lifeinbox_app'
    """).fetchone()
    if not safe or not safe[0]:
        raise RuntimeError("실행 역할 권한이 설계와 다릅니다. 관리자에게 확인해주세요.")
suffix = (admin.username or "").partition(".")[2]
runtime = admin.set(username=f"lifeinbox_app.{suffix}" if suffix else "lifeinbox_app", password=password)
set_key(env_path, "DATABASE_URL", runtime.render_as_string(hide_password=False))
print("실행 계정의 비밀번호와 DATABASE_URL을 로컬 .env에 설정했습니다. API를 다시 시작해주세요.")
