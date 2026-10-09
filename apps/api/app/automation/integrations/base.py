from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass
class NormalizedContent:
    source: str
    sender: str
    title: str
    content: str
    timestamp: datetime
    metadata: dict[str, str]
    fields: dict | None = None


class IntegrationAdapter(ABC):
    @abstractmethod
    async def fetch(self) -> list[dict]:
        """프로바이더의 원본을 반환합니다. 비밀은 구현체의 Secret Store에서 조회합니다."""

    @abstractmethod
    def normalize(self, raw: dict) -> NormalizedContent:
        """네트워크 없이 원본을 공통 형식으로 변환합니다."""
