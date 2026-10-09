from decimal import Decimal


def field_result(value, confidence, reason, source="parser", needs_review=False):
    return {"value": value, "confidence": float(confidence), "reason": reason,
            "source": source, "needs_review": needs_review}


def confirm_field(candidate, field, value, reason, source="user"):
    candidate.field_confidences = {**candidate.field_confidences,
                                  field: field_result(value, 1, reason, source)}


def review_fields(candidate, threshold):
    return [key for key, entry in candidate.field_confidences.items()
            if entry.get("needs_review") or (entry.get("value") is not None
            and Decimal(str(entry.get("confidence", 0))) < threshold)]


def can_capture(candidate, settings):
    return (settings.level != "suggest" and candidate.confidence >= settings.capture_threshold
            and not review_fields(candidate, settings.capture_threshold))
