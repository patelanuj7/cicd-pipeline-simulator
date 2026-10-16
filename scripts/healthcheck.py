#!/usr/bin/env python3
"""Poll a service's /health endpoint until it reports the expected build.

A deploy only counts as done when the *new* version answers, so this keeps
polling until /health returns status "ok" AND the sha of the commit being
deployed. That catches an old container still serving and slow cold starts.

Usage:
    python scripts/healthcheck.py --url https://my-service.example.com --expect-sha <sha>

Exit code 0 when healthy, 1 on timeout. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

MAX_DELAY_SECONDS = 30.0
REQUEST_TIMEOUT_SECONDS = 10.0
# Git never abbreviates a SHA below 4 characters, so shorter values (like "dev")
# can't be a prefix match for a real commit.
MIN_SHA_PREFIX = 4


def health_url(base: str) -> str:
    """Accept either the service root or the full /health URL."""
    base = base.rstrip("/")
    return base if base.endswith("/health") else base + "/health"


def sha_matches(actual: str, expected: str) -> bool:
    """True if one SHA is a prefix of the other (short vs. full form)."""
    actual, expected = actual.strip().lower(), expected.strip().lower()
    if actual == expected:
        return True
    shorter, longer = sorted((actual, expected), key=len)
    return len(shorter) >= MIN_SHA_PREFIX and longer.startswith(shorter)


def check_once(url: str, expected_sha: str, timeout: float) -> tuple[bool, str]:
    """Make one request. Returns (healthy, description for the log line)."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            code = resp.status
    except urllib.error.HTTPError as err:
        return False, f"HTTP {err.code}"
    except (urllib.error.URLError, OSError) as err:
        reason = getattr(err, "reason", err)
        return False, f"unreachable ({reason})"

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return False, f"HTTP {code}, response is not JSON"
    if not isinstance(data, dict):
        return False, f"HTTP {code}, unexpected JSON: {body[:80]}"

    status, sha = data.get("status"), str(data.get("sha", ""))
    detail = f"HTTP {code}, status={status!r}, sha={sha[:12]!r}"
    if status != "ok":
        return False, detail
    if not sha_matches(sha, expected_sha):
        return False, f"{detail} (waiting for {expected_sha[:12]!r})"
    return True, detail


def wait_until_healthy(
    url: str,
    expected_sha: str,
    timeout: float,
    interval: float,
    log=print,
) -> bool:
    """Poll with exponential backoff (interval, 2x, 4x, ... capped at 30s)."""
    start = time.monotonic()
    deadline = start + timeout
    delay = interval
    attempt = 0

    while True:
        attempt += 1
        remaining = deadline - time.monotonic()
        healthy, detail = check_once(url, expected_sha, min(REQUEST_TIMEOUT_SECONDS, max(remaining, 0.1)))
        elapsed = time.monotonic() - start
        prefix = f"[attempt {attempt}, {elapsed:5.1f}s]"

        if healthy:
            log(f"{prefix} {detail} -> healthy")
            return True

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            log(f"{prefix} {detail} -> giving up after {timeout:g}s")
            return False

        sleep_for = min(delay, remaining)
        log(f"{prefix} {detail} -> retrying in {sleep_for:.1f}s")
        time.sleep(sleep_for)
        delay = min(delay * 2, MAX_DELAY_SECONDS)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Wait until /health reports the expected SHA.")
    parser.add_argument("--url", required=True, help="service base URL or full /health URL")
    parser.add_argument("--expect-sha", required=True, help="commit SHA the service must report (prefix ok)")
    parser.add_argument("--timeout", type=float, default=300.0, help="total seconds to wait (default 300)")
    parser.add_argument("--interval", type=float, default=5.0, help="first retry delay in seconds (default 5)")
    args = parser.parse_args(argv)
    if args.timeout <= 0 or args.interval <= 0:
        parser.error("--timeout and --interval must be positive")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    url = health_url(args.url)
    print(f"Checking {url} for sha {args.expect_sha} (timeout {args.timeout:g}s)", flush=True)
    ok = wait_until_healthy(
        url, args.expect_sha, args.timeout, args.interval, log=lambda m: print(m, flush=True)
    )
    print("HEALTHY" if ok else "UNHEALTHY", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
