"""Check the read-only Supabase health RPC without accessing application data."""

import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

TIMEOUT_SECONDS = 20
RETRY_DELAYS = (5, 10)
RETRY_STATUSES = {408, 429, 500, 502, 503, 504}


class HealthCheckError(Exception):
    """An error message that is safe to include in an Actions log."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward the API key to a redirected destination.
        return None


def health_request(url: str, key: str) -> Request:
    if not re.fullmatch(r"https://[a-z0-9]{20}\.supabase\.co/?", url):
        raise HealthCheckError("Set SUPABASE_URL to the HTTPS Project URL from Supabase Dashboard.")
    if not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key):
        raise HealthCheckError("Set SUPABASE_PUBLISHABLE_KEY to a publishable key (sb_publishable_...).")
    return Request(
        url.rstrip("/") + "/rest/v1/rpc/lifeinbox_healthcheck",
        headers={"apikey": key, "Accept": "application/json", "Cache-Control": "no-cache"},
        method="GET",
    )


def check_health(url: str, key: str) -> int:
    request = health_request(url, key)
    opener = build_opener(NoRedirect())
    for attempt in range(1, len(RETRY_DELAYS) + 2):
        try:
            with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
                if response.status != 200:
                    raise HealthCheckError(f"Unexpected HTTP status {response.status}.")
                # The only expected body is the JSON string "ok".
                body = response.read(1024)
            try:
                valid = json.loads(body) == "ok"
            except (ValueError, UnicodeError):
                valid = False
            if not valid:
                raise HealthCheckError('Unexpected health response; expected JSON "ok".')
            return attempt
        except HTTPError as error:
            status = error.code
            error.close()
            if status not in RETRY_STATUSES:
                hints = {
                    401: "Check the publishable key.",
                    403: "Check the API key and function execute permissions.",
                    404: "Apply migration 0007 and check that the Data API is enabled.",
                }
                hint = hints.get(status, "Check the Supabase project and Data API settings.")
                raise HealthCheckError(f"HTTP {status}. {hint}") from None
            reason = f"HTTP {status}"
        except (URLError, TimeoutError):
            reason = "Network connection or request timeout"
        if attempt > len(RETRY_DELAYS):
            raise HealthCheckError(f"{reason}; health check failed after {attempt} attempts.")
        print(f"{reason}; retrying ({attempt}/{len(RETRY_DELAYS) + 1}).")
        time.sleep(RETRY_DELAYS[attempt - 1])
    raise HealthCheckError("Health check did not finish.")


def main() -> int:
    checked_at = datetime.now(UTC).isoformat(timespec="seconds")
    try:
        attempts = check_health(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_PUBLISHABLE_KEY", ""))
        result = f"Supabase DB health check: passed\nChecked at (UTC): {checked_at}\nAttempts: {attempts}\n"
        exit_code = 0
    except HealthCheckError as error:
        result = f"Supabase DB health check: failed\nChecked at (UTC): {checked_at}\n{error}\n"
        exit_code = 1
    print(result, end="")
    summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_file:
        with Path(summary_file).open("a", encoding="utf-8") as summary:
            summary.write(result.replace("\n", "  \n"))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
