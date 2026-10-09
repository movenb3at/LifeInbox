from decimal import Decimal, InvalidOperation

from app.schemas.automation import Condition


def evaluate(condition: Condition, context: dict) -> bool:
    actual = context.get(condition.field)
    if actual is None:
        return False
    if condition.field in ("confidence", "amount"):
        try:
            left, right = Decimal(str(actual)), Decimal(condition.value)
            if not left.is_finite() or not right.is_finite():
                return False
            return {"equals": left == right, "greater_than": left > right, "greater_or_equal": left >= right, "less_than": left < right}[condition.operator]
        except InvalidOperation:
            return False
    left, right = str(actual).casefold(), condition.value.casefold()
    return left == right if condition.operator == "equals" else right in left


def match_conditions(conditions: list[dict], context: dict) -> tuple[bool, list[dict]]:
    results = [{**data, "matched": evaluate(Condition.model_validate(data), context)} for data in conditions]
    return all(result["matched"] for result in results), results
