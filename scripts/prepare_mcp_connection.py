"""Prepare a runtime DB login locally after a migration was applied through MCP."""

import argparse
import base64
import hashlib
import hmac
import re
import secrets
from pathlib import Path

from dotenv import dotenv_values, set_key
from sqlalchemy.engine import URL

ROOT = Path(__file__).resolve().parents[1]


def scram_verifier(password: str) -> str:
    """Build PostgreSQL's SCRAM verifier for a randomly generated ASCII password."""
    salt = secrets.token_bytes(16)
    iterations = 4096
    salted = hashlib.pbkdf2_hmac("sha256", password.encode("ascii"), salt, iterations)
    client_key = hmac.digest(salted, b"Client Key", "sha256")
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.digest(salted, b"Server Key", "sha256")
    encoded = [base64.b64encode(value).decode("ascii") for value in (salt, stored_key, server_key)]
    return f"SCRAM-SHA-256${iterations}:{encoded[0]}${encoded[1]}:{encoded[2]}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-ref", required=True)
    parser.add_argument("--pooler-host", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z]{20}", args.project_ref):
        parser.error("Supabase 프로젝트 ref를 확인해주세요.")
    if not re.fullmatch(r"[a-z0-9.-]+\.pooler\.supabase\.com", args.pooler_host):
        parser.error("Connect → Session pooler의 Host 값을 입력해주세요.")
    env_path = ROOT / "apps/api/.env"
    existing = dotenv_values(env_path)
    if existing.get("DATABASE_URL") and "POOLER_HOST" not in existing["DATABASE_URL"]:
        parser.error("이미 실행 연결값이 있습니다. 기존 연결값을 확인해주세요.")
    password = secrets.token_urlsafe(48)
    runtime = URL.create(
        "postgresql+psycopg", username=f"lifeinbox_app.{args.project_ref}", password=password,
        host=args.pooler_host, port=5432, database="postgres", query={"sslmode": "require"},
    )
    set_key(env_path, "DATABASE_URL", runtime.render_as_string(hide_password=False))
    set_key(env_path, "SUPABASE_URL", f"https://{args.project_ref}.supabase.co")
    set_key(env_path, "APP_TIMEZONE", "Asia/Seoul")
    sql_path = ROOT / ".local/runtime-role.sql"
    sql_path.parent.mkdir(exist_ok=True)
    # Keep the plaintext password in the local environment file, out of MCP migration history.
    verifier = scram_verifier(password)
    sql_path.write_text(f"ALTER ROLE lifeinbox_app PASSWORD '{verifier}';\n", encoding="utf-8")
    print("로컬 실행 연결값과 MCP 적용용 SQL을 준비했습니다. 비밀번호는 출력하지 않습니다.")
    print(".local/runtime-role.sql을 MCP로 적용한 뒤 해당 파일을 삭제해주세요.")


if __name__ == "__main__":
    main()
