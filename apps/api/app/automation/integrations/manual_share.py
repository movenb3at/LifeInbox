from datetime import UTC, datetime

from app.automation.integrations.base import IntegrationAdapter, NormalizedContent
from app.schemas.automation import ShareInput


class ManualShareIntegration(IntegrationAdapter):
    async def fetch(self) -> list[dict]:
        return []

    def normalize(self, raw: dict) -> NormalizedContent:
        data = ShareInput.model_validate(raw)
        return NormalizedContent(
            source=data.source_type, sender=data.sender, title=data.title,
            content=data.content, timestamp=data.timestamp or datetime.now(UTC), metadata=data.metadata,
            fields=data.fields.model_dump(mode="json") if data.fields else None,
        )
