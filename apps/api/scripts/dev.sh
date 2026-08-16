#!/usr/bin/env bash
# Starts the service, after checking the two things that actually go wrong:
# a missing virtual environment and a port someone else is already holding.
#
# uvicorn --reload runs a reloader plus a worker, so killing the parent can
# leave the child holding the port. The bare failure is "[Errno 48] Address
# already in use", which says nothing about who has it or how to get it back.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-8000}"

if [[ ! -x ./.venv/bin/uvicorn ]]; then
  echo "No Python environment yet — building one."
  bash scripts/setup.sh
fi

if holder=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | tail -n +2); then
  if [[ -n "$holder" ]]; then
    pids=$(printf '%s\n' "$holder" | awk '{print $2}' | sort -u | tr '\n' ' ')
    echo "Port $PORT is already in use by PID(s): ${pids%% }" >&2
    printf '%s\n' "$holder" | awk '{printf "  %s (pid %s)\n", $1, $2}' >&2
    echo >&2
    echo "Most often this is an earlier 'pnpm dev' whose reloader outlived it." >&2
    echo "Free it with:  kill ${pids%% }" >&2
    echo "Or run elsewhere:  PORT=8001 pnpm dev:api" >&2
    exit 1
  fi
fi

exec ./.venv/bin/uvicorn app.main:app --reload --port "$PORT"
