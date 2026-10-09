from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_engine
from app.core.security import verify_token
from app.repositories.items import ItemRepository

bearer = HTTPBearer(auto_error=False)


def current_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> UUID:
    if credentials is None:
        raise HTTPException(401, "로그인이 필요합니다.", headers={"WWW-Authenticate": "Bearer"})
    return verify_token(credentials.credentials)


def repository(user_id: Annotated[UUID, Depends(current_user)]):
    with Session(get_engine()) as session, session.begin():
        safe_role = session.execute(text("""
            SELECT current_user='lifeinbox_app' AND NOT (rolsuper OR rolbypassrls OR rolinherit)
            AND NOT EXISTS (
                SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='app' AND c.relowner=pg_roles.oid
            ) FROM pg_roles WHERE rolname=current_user
        """)).scalar()
        if not safe_role:
            raise HTTPException(503, "DB 실행 계정 권한을 확인해주세요.")
        session.execute(text("SELECT set_config('app.user_id', :user_id, true)"), {"user_id": str(user_id)})
        yield ItemRepository(session, user_id)


Repo = Annotated[ItemRepository, Depends(repository)]
