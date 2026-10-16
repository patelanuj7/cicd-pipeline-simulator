"""Tests for healthcheck.py against a real local HTTP server (no mocks of urllib)."""

from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import healthcheck

FAST = ["--interval", "0.05"]


class FakeService:
    """Serves /health from a queue of responses; the last one repeats forever."""

    def __init__(self, responses: list[tuple[int, object]]):
        self.responses = list(responses)
        self.requests = 0
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                fake.requests += 1
                code, body = fake.responses[0] if len(fake.responses) == 1 else fake.responses.pop(0)
                payload = body.encode() if isinstance(body, str) else json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):  # keep test output quiet
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def service():
    started = []

    def start(*responses):
        fake = FakeService(list(responses))
        started.append(fake)
        return fake

    yield start
    for fake in started:
        fake.close()


def healthy(sha):
    return (200, {"status": "ok", "sha": sha, "uptimeSeconds": 1})


def test_success_on_first_attempt(service, capsys):
    fake = service(healthy("abc123def456"))

    code = healthcheck.main(["--url", fake.url, "--expect-sha", "abc123def456", "--timeout", "5", *FAST])

    assert code == 0
    assert fake.requests == 1
    out = capsys.readouterr().out
    assert "[attempt 1," in out
    assert "HEALTHY" in out


def test_wrong_sha_then_right_sha(service, capsys):
    # Old version still serving for two polls, then the new deploy answers.
    fake = service(healthy("0ld0ld0ld"), healthy("0ld0ld0ld"), healthy("new123456"))

    code = healthcheck.main(["--url", fake.url, "--expect-sha", "new123456", "--timeout", "5", *FAST])

    assert code == 0
    assert fake.requests == 3
    out = capsys.readouterr().out
    assert "waiting for 'new123456'" in out
    assert "[attempt 3," in out


def test_not_ready_responses_are_retried(service):
    fake = service((503, "starting"), (200, "not json"), (200, {"status": "starting", "sha": "abc1"}), healthy("abc1"))

    code = healthcheck.main(["--url", fake.url, "--expect-sha", "abc1", "--timeout", "5", *FAST])

    assert code == 0
    assert fake.requests == 4


def test_timeout_when_sha_never_matches(service, capsys):
    fake = service(healthy("abc123"))

    code = healthcheck.main(["--url", fake.url, "--expect-sha", "nope", "--timeout", "0.5", *FAST])

    assert code == 1
    assert fake.requests > 1
    out = capsys.readouterr().out
    assert "giving up after 0.5s" in out
    assert "UNHEALTHY" in out


def test_connection_refused_times_out(capsys):
    # Grab a free port, then close it so nothing is listening there.
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    code = healthcheck.main(["--url", f"http://127.0.0.1:{port}", "--expect-sha", "abc", "--timeout", "0.5", *FAST])

    assert code == 1
    assert "unreachable" in capsys.readouterr().out


def test_backoff_doubles_and_is_capped(monkeypatch):
    sleeps = []
    clock = [0.0]
    monkeypatch.setattr(healthcheck.time, "sleep", lambda s: (sleeps.append(s), clock.__setitem__(0, clock[0] + s)))
    monkeypatch.setattr(healthcheck.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(healthcheck, "check_once", lambda *a: (False, "down"))

    assert healthcheck.wait_until_healthy("http://x/health", "abc", timeout=200, interval=5, log=lambda m: None) is False
    assert sleeps[:5] == [5, 10, 20, 30, 30]
    assert sum(sleeps) == pytest.approx(200)  # never sleeps past the deadline


@pytest.mark.parametrize(
    ("actual", "expected", "match"),
    [
        ("abc123", "abc123", True),
        ("77b9ab49011f9f9a262e7209ed16642a509be6f6", "77b9ab4", True),
        ("77b9ab4", "77b9ab49011f9f9a262e7209ed16642a509be6f6", True),
        ("77B9AB4", "77b9ab4", True),
        ("abc123", "nope", False),
        ("dev", "devf00d", False),  # "dev" is shorter than any real abbreviated SHA
        ("", "abc123", False),
    ],
)
def test_sha_matches(actual, expected, match):
    assert healthcheck.sha_matches(actual, expected) is match


@pytest.mark.parametrize(
    ("given", "url"),
    [
        ("https://svc.example.com", "https://svc.example.com/health"),
        ("https://svc.example.com/", "https://svc.example.com/health"),
        ("https://svc.example.com/health", "https://svc.example.com/health"),
    ],
)
def test_health_url(given, url):
    assert healthcheck.health_url(given) == url
