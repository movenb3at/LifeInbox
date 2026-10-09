import logging
import time

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.automation.service import AutomationService
from app.core.database import get_engine
from app.repositories.items import ItemRepository

logger = logging.getLogger("lifeinbox.worker")


def run_once():
    engine = get_engine()
    with engine.connect() as connection:
        safe = connection.execute(text("SELECT current_user='lifeinbox_app' AND NOT (rolsuper OR rolbypassrls OR rolinherit) FROM pg_roles WHERE rolname=current_user")).scalar()
        if not safe:
            raise RuntimeError("Unsafe automation database role")
        users = list(connection.execute(text("SELECT app.automation_worker_users()" )).scalars())
    for user_id in users:
        try:
            with Session(engine) as session, session.begin():
                session.execute(text("SELECT set_config('app.user_id',:id,true)"), {"id": str(user_id)})
                AutomationService(ItemRepository(session, user_id)).tick()
        except Exception as exc:
            logger.error("Automation worker transaction failed: %s", type(exc).__name__)


def main():
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            run_once()
        except Exception as exc:
            logger.error("Automation worker unavailable: %s", type(exc).__name__)
        time.sleep(15)


if __name__ == "__main__":
    main()
