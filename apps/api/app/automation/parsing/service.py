import re
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.automation.confidence import field_result
from app.automation.integrations.base import NormalizedContent
from app.schemas.items import ItemFields


@dataclass
class ParsedCandidate:
    fields: ItemFields
    confidence: Decimal
    explanations: list[str]
    field_confidences: dict


def field_scores(fields, structured=False, uncertain_date=False, uncertain_amount=False):
    values = fields.model_dump(mode="json")
    scores = {"title": .99, "type": .95 if fields.type != "other" else .55,
              "deadline": .95, "start_datetime": .95, "end_datetime": .95,
              "amount": .98, "currency": .98}
    result = {key: field_result(values[key], .99 if structured else score,
              "구조화 입력을 검증했습니다." if structured else "본문의 명확한 표현에서 추출했습니다.")
              for key, score in scores.items()}
    for key, uncertain in (("deadline", uncertain_date), ("amount", uncertain_amount)):
        if uncertain:
            result[key] = field_result(None, .2, "여러 표현이나 유효하지 않은 값이 있어 확인이 필요합니다.", needs_review=True)
    return result


def parse(content: NormalizedContent) -> ParsedCandidate:
    if content.fields:
        fields = ItemFields.model_validate(content.fields)
        return ParsedCandidate(fields, Decimal("0.99"), ["사용자가 제공한 구조화 필드를 검증했습니다."], field_scores(fields, structured=True))
    text = f"{content.title}\n{content.content}"
    item_type = "other"
    reasons = ["규칙 기반 분석입니다. 모호한 날짜와 일정은 확인이 필요합니다."]
    for kind, words in [
        ("payment", ("결제", "입금", "납부", "청구")), ("delivery", ("택배", "배송")),
        ("reservation", ("예약", "진료")), ("deadline", ("제출", "마감", "까지")),
        ("event", ("회의", "행사", "일정")), ("purchase", ("구매", "주문")),
    ]:
        if any(word in text for word in words):
            item_type = kind
            reasons.append(f"본문의 표현으로 {kind} 종류를 제안했습니다.")
            break
    deadline = None
    matches = list(re.finditer(r"(?:(\d{4})[년./-]\s*)?(\d{1,2})(?:월\s*|[./-])(\d{1,2})(?:일)?", text))
    if len(matches) == 1:
        match = matches[0]
        year = int(match[1]) if match[1] else content.timestamp.astimezone(ZoneInfo("Asia/Seoul")).year
        try:
            deadline = date(year, int(match[2]), int(match[3]))
            reasons.append(f"날짜 표현 {match[0]}을 {deadline.isoformat()}로 해석했습니다.")
        except ValueError:
            reasons.append("유효하지 않은 날짜를 발견하여 마감일을 비워두었습니다.")
    elif len(matches) > 1:
        reasons.append("날짜가 여러 개여서 마감일을 자동으로 결정하지 않았습니다.")
    start = None
    if not matches:
        today = content.timestamp.astimezone(ZoneInfo("Asia/Seoul")).date()
        relative = re.findall(r"오늘|내일|모레|[월화수목금토일]요일", text)
        if len(relative) == 1:
            word = relative[0]
            offset = {"오늘": 0, "내일": 1, "모레": 2}.get(word)
            if offset is None:
                offset = ("월화수목금토일".index(word[0]) - today.weekday()) % 7
            deadline = today + timedelta(days=offset)
            reasons.append(f"원본 시각을 기준으로 {word}을 {deadline.isoformat()}로 해석했습니다.")
        if len(relative) > 1:
            reasons.append("상대 날짜가 여러 개여서 확인이 필요합니다.")
    else:
        relative = []
    clock = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)", text)
    uncertain_time = False
    if item_type in ("event", "reservation") and deadline and clock:
        try:
            start = datetime.combine(deadline, time(int(clock[1]), int(clock[2])), ZoneInfo("Asia/Seoul"))
            deadline = None
        except ValueError:
            uncertain_time = True
            reasons.append("일정 시각이 유효하지 않아 확인이 필요합니다.")
    amount = None
    amounts = list(re.finditer(r"(?<![\d.,+-])([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(원|USD|달러|엔|EUR|유로|GBP|CNY)(?![A-Za-z0-9])", text))
    money = amounts[0] if len(amounts) == 1 else None
    if len(amounts) > 1:
        reasons.append("금액이 여러 개여서 자동으로 결정하지 않았습니다.")
    currency = "KRW"
    if money:
        currency = {"원": "KRW", "달러": "USD", "엔": "JPY", "유로": "EUR"}.get(money[2], money[2])
        amount = Decimal(money[1].replace(",", ""))
        if amount < 0 or amount >= Decimal("1000000000000") or (currency in ("KRW", "JPY") and amount != amount.to_integral_value()):
            amount = None
            reasons.append("금액 범위·소수 제약을 확인해야 하므로 금액을 비워두었습니다.")
        else:
            reasons.append(f"금액 표현 {money[0]}을 추출했습니다.")
    confidence = Decimal("0.55")
    if item_type != "other":
        confidence += Decimal("0.15")
    if deadline:
        confidence += Decimal("0.12")
    if amount is not None:
        confidence += Decimal("0.10")
    fields = ItemFields(
        title=content.title or content.content.splitlines()[0][:200], description=content.content,
        type=item_type, deadline=deadline, start_datetime=start, amount=amount, currency=currency,
    )
    uncertain_date = len(matches) > 1 or len(relative) > 1 or (bool(matches or relative) and deadline is None and start is None)
    scores = field_scores(fields, uncertain_date=uncertain_date, uncertain_amount=(bool(money) and amount is None) or len(amounts) > 1)
    if uncertain_time:
        scores["start_datetime"] = field_result(None, .2, "일정 시각을 확인해주세요.", needs_review=True)
    return ParsedCandidate(fields, confidence, reasons, scores)


def parse_many(content: NormalizedContent) -> list[ParsedCandidate]:
    # OCR 줄바꿈은 화면 배치 때문에 생기므로 스크린샷 전체를 한 문서로 분석합니다.
    if content.fields or content.source == "screenshot":
        return [parse(content)]
    lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", line).strip()
             for line in content.content.splitlines() if line.strip()]
    # 각 줄에 독립된 행동 표현이 있을 때만 분리합니다. 일반 설명의 줄바꿈은 유지합니다.
    independent = re.compile(r"제출|마감|결제|입금|납부|회의|예약|배송|택배|구매|주문|행사")
    if len(lines) > 1 and all(independent.search(line) for line in lines):
        if len(lines) > 20:
            raise ValueError("한 원본에서 최대 20개 후보를 분석합니다. 내용을 나누어 수집해주세요.")
        return [parse(replace(content, title="", content=line)) for line in lines]
    return [parse(content)]
