from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import select

from app.api.dependencies import Repo
from app.automation.screenshots import ScreenshotService
from app.automation.service import AutomationService
from app.models.automation import AutomationRun, InboundEvent, ItemCandidate, Notification, ScreenshotInput
from app.schemas.automation import (
    CandidateOut,
    CandidatePatch,
    EventOut,
    IntegrationDestination,
    IntegrationOut,
    NotificationOut,
    RuleInput,
    RuleOut,
    RunOut,
    SettingsInput,
    ShareInput,
    SummaryOut,
)

router = APIRouter(prefix="/api/v1")
Page = Annotated[int, Query(ge=1, le=100000)]


@router.get("/automation/settings", response_model=SettingsInput)
def settings(repo: Repo):
    return AutomationService(repo).settings()


@router.patch("/automation/settings", response_model=SettingsInput)
def update_settings(data: SettingsInput, repo: Repo):
    return AutomationService(repo).update_settings(data)


@router.get("/automation/summary", response_model=SummaryOut)
def summary(repo: Repo):
    return AutomationService(repo).summary()


@router.get("/automation/integrations", response_model=list[IntegrationOut])
def integrations(repo: Repo):
    return AutomationService(repo).integrations()


@router.patch("/automation/integrations/{integration_id}/destination", response_model=IntegrationOut)
def destination(integration_id: UUID, data: IntegrationDestination, repo: Repo):
    return AutomationService(repo).integration_destination(integration_id, data.space_id)


@router.post("/automation/events", response_model=EventOut, status_code=201)
def ingest(data: ShareInput, repo: Repo):
    return AutomationService(repo).ingest(data)


@router.get("/automation/events", response_model=list[EventOut])
def events(repo: Repo, page: Page = 1):
    return AutomationService(repo).rows(InboundEvent, page)


@router.post("/automation/events/{event_id}/retry", response_model=EventOut)
def retry(event_id: UUID, repo: Repo):
    service = AutomationService(repo)
    event = service.owned(InboundEvent, event_id)
    if event.source_type == "screenshot":
        image = repo.session.scalar(select(ScreenshotInput).where(
            ScreenshotInput.inbound_event_id == event.id, ScreenshotInput.user_id == repo.user_id))
        if image:
            if not image.ocr_text:
                raise HTTPException(409, "보관한 스크린샷 목록에서 이미지 판독을 재시도해주세요.")
            ScreenshotService(repo).retry(image.id)
            return event
    return service.retry(event_id)


@router.get("/automation/candidates", response_model=list[CandidateOut])
def candidates(repo: Repo, page: Page = 1, status: Annotated[str | None, Query(pattern="^(pending|accepted|auto_accepted|rejected|expired)$")] = "pending"):
    service = AutomationService(repo)
    return [service.candidate_out(row) for row in service.rows(ItemCandidate, page, status)]


@router.patch("/automation/candidates/{candidate_id}", response_model=CandidateOut)
def edit_candidate(candidate_id: UUID, data: CandidatePatch, repo: Repo):
    service = AutomationService(repo)
    return service.candidate_out(service.patch_candidate(candidate_id, data))


@router.post("/automation/candidates/{candidate_id}/accept", response_model=CandidateOut)
def accept(candidate_id: UUID, repo: Repo):
    service = AutomationService(repo)
    return service.candidate_out(service.accept(candidate_id))


@router.post("/automation/candidates/{candidate_id}/reject", response_model=CandidateOut)
def reject(candidate_id: UUID, repo: Repo):
    service = AutomationService(repo)
    return service.candidate_out(service.reject(candidate_id))


@router.get("/automation/rules", response_model=list[RuleOut])
def rules(repo: Repo):
    return AutomationService(repo).rules()


@router.post("/automation/rules", response_model=RuleOut, status_code=201)
def create_rule(data: RuleInput, repo: Repo):
    return AutomationService(repo).save_rule(data)


@router.patch("/automation/rules/{rule_id}", response_model=RuleOut)
def update_rule(rule_id: UUID, data: RuleInput, repo: Repo):
    return AutomationService(repo).save_rule(data, rule_id)


@router.delete("/automation/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: UUID, repo: Repo):
    AutomationService(repo).delete_rule(rule_id)
    return Response(status_code=204)


@router.get("/automation/runs", response_model=list[RunOut])
def runs(repo: Repo, page: Page = 1):
    return AutomationService(repo).rows(AutomationRun, page)


@router.post("/automation/tick")
def tick(repo: Repo):
    return {"delivered": AutomationService(repo).tick()}


@router.get("/notifications", response_model=list[NotificationOut])
def notifications(repo: Repo, page: Page = 1):
    return AutomationService(repo).rows(Notification, page)


@router.patch("/notifications/{notification_id}/read", response_model=NotificationOut)
def read_notification(notification_id: UUID, repo: Repo):
    row = AutomationService(repo).owned(Notification, notification_id, lock=True)
    if row.status == "delivered":
        row.read_at = datetime.now(UTC)
        repo.session.flush()
    return row
