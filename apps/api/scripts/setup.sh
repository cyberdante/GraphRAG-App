#!/usr/bin/env bash
# Creates apps/api/.venv and installs the service in editable mode.
# Picks the newest Python >= 3.11 it can find, including a Homebrew or Anaconda
# install that is not on PATH.
set -euo pipefail

cd "$(dirname "$0")/.."

find_python() {
  if [[ -n "${PYTHON:-}" ]]; then
    echo "$PYTHON"
    return
  fi
  for candidate in \
    python3.13 python3.12 python3.11 \
    /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 \
    /opt/anaconda3/bin/python3.12 /opt/anaconda3/bin/python3.11; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return
    fi
  done
  return 1
}

if ! PY="$(find_python)"; then
  echo "No Python 3.11+ found. Install one (brew install python@3.12) or set PYTHON=/path/to/python." >&2
  exit 1
fi

echo "Using $PY ($("$PY" --version))"

if [[ ! -d .venv ]]; then
  "$PY" -m venv .venv
fi

./.venv/bin/python -m pip install --quiet --upgrade pip
./.venv/bin/python -m pip install --quiet -e ".[dev]"

echo "Ready. Run the service with: pnpm dev:api"
