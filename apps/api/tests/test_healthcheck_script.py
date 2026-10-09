import importlib.util
import io
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

import pytest

spec = importlib.util.spec_from_file_location(
    "check_supabase_health", Path(__file__).resolve().parents[3] / "scripts/check_supabase_health.py"
)
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)

PROJECT_URL = "https://abcdefghijklmnopqrst.supabase.co"
KEY = "sb_publishable_test_value"


def response(body=b'"ok"', status=200):
    result = MagicMock()
    result.__enter__.return_value = result
    result.status = status
    result.read.return_value = body
    return result


def test_valid_request_is_get_and_uses_only_publishable_key():
    request = health.health_request(PROJECT_URL + "/", KEY)
    assert request.full_url == PROJECT_URL + "/rest/v1/rpc/lifeinbox_healthcheck"
    assert request.get_method() == "GET"
    assert request.get_header("Apikey") == KEY
    assert not request.has_header("Authorization")
    assert health.NoRedirect().redirect_request(request, None, 302, "Found", {}, "https://example.com") is None


@pytest.mark.parametrize("url", ["", "http://localhost:8000", "https://example.com", PROJECT_URL + "?apikey=secret"])
def test_invalid_url_never_sends_request(url):
    with patch.object(health, "build_opener") as opener, pytest.raises(health.HealthCheckError):
        health.check_health(url, KEY)
    opener.assert_not_called()


@pytest.mark.parametrize("key", ["", "sb_secret_admin", "eyJlegacyJWT", KEY + "\r\nInjected: value"])
def test_non_publishable_key_never_sends_request(key):
    with patch.object(health, "build_opener") as opener, pytest.raises(health.HealthCheckError):
        health.check_health(PROJECT_URL, key)
    opener.assert_not_called()


def test_success_is_one_request_without_retry():
    with patch.object(health, "build_opener") as build, patch.object(health.time, "sleep") as sleep:
        build.return_value.open.return_value = response()
        assert health.check_health(PROJECT_URL, KEY) == 1
    assert build.return_value.open.call_count == 1
    assert build.return_value.open.call_args.kwargs["timeout"] == 20
    sleep.assert_not_called()


def test_transient_error_retries_then_succeeds():
    unavailable = HTTPError(PROJECT_URL, 503, KEY, {}, io.BytesIO(KEY.encode()))
    with patch.object(health, "build_opener") as build, patch.object(health.time, "sleep") as sleep:
        build.return_value.open.side_effect = [unavailable, URLError(KEY), response()]
        assert health.check_health(PROJECT_URL, KEY) == 3
    assert sleep.call_args_list == [((5,),), ((10,),)]


@pytest.mark.parametrize("status", [302, 401, 403, 404])
def test_permanent_errors_fail_without_leaking_body_or_key(status, capsys):
    failure = HTTPError(PROJECT_URL, status, KEY, {}, io.BytesIO(KEY.encode()))
    with patch.object(health, "build_opener") as build, patch.object(health.time, "sleep") as sleep:
        build.return_value.open.side_effect = failure
        with pytest.raises(health.HealthCheckError, match=f"HTTP {status}") as error:
            health.check_health(PROJECT_URL, KEY)
    sleep.assert_not_called()
    assert KEY not in str(error.value) + capsys.readouterr().out


def test_network_errors_stop_after_three_attempts():
    with patch.object(health, "build_opener") as build, patch.object(health.time, "sleep") as sleep:
        build.return_value.open.side_effect = URLError(KEY)
        with pytest.raises(health.HealthCheckError, match="failed after 3 attempts"):
            health.check_health(PROJECT_URL, KEY)
    assert build.return_value.open.call_count == 3
    assert sleep.call_count == 2


@pytest.mark.parametrize("body", [b"<html>error</html>", b'{"status":"ok"}', b"\xff", b'"ok"' + b"x" * 1100])
def test_unexpected_success_body_fails(body):
    with patch.object(health, "build_opener") as build:
        build.return_value.open.return_value = response(body)
        with pytest.raises(health.HealthCheckError, match="Unexpected health response"):
            health.check_health(PROJECT_URL, KEY)


@pytest.mark.parametrize("success", [True, False])
def test_cli_exit_code_and_actions_summary(success, tmp_path, capsys):
    summary = tmp_path / "summary.md"
    with patch.dict(health.os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), patch.object(health, "check_health") as check:
        if success:
            check.return_value = 1
        else:
            check.side_effect = health.HealthCheckError("HTTP 401. Check the publishable key.")
        assert health.main() == (0 if success else 1)
    expected = "passed" if success else "failed"
    assert expected in summary.read_text(encoding="utf-8")
    assert KEY not in capsys.readouterr().out
