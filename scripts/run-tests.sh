#!/usr/bin/env bash
# Runs every test suite (service, dashboard, Python scripts), writes JUnit XML
# reports to reports/, prints a summary, and exits non-zero if any suite failed.
# All suites run even if an earlier one fails, so one run shows every failure.
#
# Usage: bash scripts/run-tests.sh   (Git Bash on Windows, or Linux/macOS)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPORTS_DIR="reports"
rm -rf "$REPORTS_DIR"
mkdir -p "$REPORTS_DIR"

# Pick a Python that actually runs. On Windows, `python3` may be the Microsoft
# Store placeholder: it exists on PATH but only prints "Python was not found".
find_python() {
  local candidate
  for candidate in ${PYTHON:-} python3 python; do
    if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 12))' >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

names=()
results=()
durations=()
failed=0

# record <name> <exit code> <seconds>
record() {
  names+=("$1")
  durations+=("$3")
  case "$2" in
    0) results+=("PASS") ;;
    skip) results+=("SKIP") ;;
    *) results+=("FAIL (exit $2)"); failed=1 ;;
  esac
}

# run_suite <name> <command...>: runs the command, never aborts the script.
run_suite() {
  local name="$1"; shift
  local start=$SECONDS code=0
  echo
  echo "=== $name ==="
  "$@" || code=$?
  record "$name" "$code" $((SECONDS - start))
}

# Vitest resolves --outputFile relative to the workspace dir, hence ../reports.
run_suite "service (vitest)" \
  npm test -w service -- --reporter=default --reporter=junit --outputFile.junit="../$REPORTS_DIR/service-junit.xml"

run_suite "dashboard (vitest)" \
  npm test -w dashboard -- --reporter=default --reporter=junit --outputFile.junit="../$REPORTS_DIR/dashboard-junit.xml"

echo
echo "=== scripts (pytest) ==="
start=$SECONDS
if ! PY="$(find_python)"; then
  echo "No working Python 3.12+ found (tried: ${PYTHON:-} python3 python)."
  record "scripts (pytest)" "no-python" $((SECONDS - start))
else
  code=0
  "$PY" -m pytest scripts --junitxml="$REPORTS_DIR/scripts-junit.xml" || code=$?
  # pytest exit code 5 = no tests collected. That's "nothing to run", not a failure.
  if [ "$code" -eq 5 ]; then
    echo "No Python tests collected; marking as skipped."
    code=skip
  fi
  record "scripts (pytest)" "$code" $((SECONDS - start))
fi

echo
echo "================ Test summary ================"
for i in "${!names[@]}"; do
  printf '  %-22s %-16s %4ss\n' "${names[$i]}" "${results[$i]}" "${durations[$i]}"
done
echo "  JUnit reports: $REPORTS_DIR/"
ls -1 "$REPORTS_DIR" | sed 's/^/    /'
echo "=============================================="

if [ "$failed" -ne 0 ]; then
  echo "RESULT: FAILED"
  exit 1
fi
echo "RESULT: PASSED"
