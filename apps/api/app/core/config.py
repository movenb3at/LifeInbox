from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env", extra="ignore"
    )
    database_url: str = ""
    supabase_url: str = ""
    app_timezone: Literal["Asia/Seoul"] = "Asia/Seoul"

    @property
    def configured(self) -> bool:
        return bool(self.database_url and self.supabase_url and "PROJECT_REF" not in self.supabase_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()
