#!/usr/bin/env bash
# Regenerates the visual baselines inside the image CI uses.
#
# Font rasterisation and subpixel antialiasing differ between macOS and Linux,
# so a baseline taken on a laptop fails in CI for reasons that are not
# regressions. The app is built on the host — the bundle is platform-independent
# — then served and photographed in the container.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(cd ../.. && pwd)"
IMAGE="mcr.microsoft.com/playwright:v1.62.1-noble"

echo "Building the mock bundle on the host..."
pnpm build:mock

echo "Photographing in $IMAGE..."
docker run --rm \
  -v "$REPO":/repo \
  -w /repo/apps/web \
  -e CI=1 \
  -e PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 \
  "$IMAGE" \
  bash -lc '
    # A static server rather than vite preview: the host node_modules holds
    # macOS binaries for esbuild and rollup, which cannot run here.
    python3 -m http.server 4173 --bind 127.0.0.1 --directory dist > /dev/null 2>&1 &
    for _ in $(seq 1 40); do
      curl -sf http://127.0.0.1:4173/ > /dev/null && break
      sleep 0.25
    done
    npx playwright test e2e/appearance.spec.ts "$@"
  ' -- "$@"
