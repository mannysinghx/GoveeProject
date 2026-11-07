#!/usr/bin/env bash
#
# The project's CI. Runs on this machine, in a Linux container on the Active LTS
# release of Node, against a clean checkout of a commit rather than the working tree.
# It never uses GitHub.
#
#   scripts/ci-local.sh            Checks HEAD.
#   scripts/ci-local.sh <commit>   Checks a specific commit.
#   scripts/ci-local.sh --image    Also builds the production image and smoke tests it.
#
# Requires Docker. No Govee key or physical light is needed.
set -euo pipefail

BUILD_IMAGE=false
COMMIT=HEAD
for arg in "$@"; do
  case "$arg" in
    --image) BUILD_IMAGE=true ;;
    *) COMMIT="$arg" ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SHA="$(git rev-parse --verify "$COMMIT^{commit}")"
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "==> Clean checkout of $SHA"
git archive "$SHA" | tar -x -C "$WORK"

CONTAINER_IMAGE="node:26-bookworm-slim"
echo "==> Running checks in $CONTAINER_IMAGE"
# Streamed in rather than bind-mounted, so this works whichever paths Docker shares.
tar -C "$WORK" -cf - . | docker run --rm -i \
  --tmpfs /tmp:exec \
  -e CI=true \
  -e NPM_CONFIG_UPDATE_NOTIFIER=false \
  "$CONTAINER_IMAGE" \
  bash -euo pipefail -c '
    mkdir /tmp/app
    tar -xf - -C /tmp/app
    apt-get update -qq >/dev/null
    apt-get install -y -qq --no-install-recommends python3 make g++ >/dev/null
    cd /tmp/app
    echo "--- node $(node -v), npm $(npm -v)"
    echo "--- npm ci"
    npm ci --no-audit --no-fund
    echo "--- build"
    npm run build
    echo "--- typecheck"
    npm run typecheck
    echo "--- lint"
    npm run lint
    echo "--- tests"
    npm test
    echo "--- dependency audit (production dependencies)"
    npm audit --omit=dev --audit-level=high
    echo "--- no secrets or sourcemaps in the frontend bundle"
    if grep -rIl "Govee-API-Key\|openapi.api.govee.com" apps/web/dist; then
      echo "The frontend bundle refers to the Govee API directly" >&2
      exit 1
    fi
    if [ -n "$(find apps/web/dist -name "*.map")" ]; then
      echo "Source maps found in the frontend bundle" >&2
      exit 1
    fi
    echo "--- all checks passed"
  '

if [ "$BUILD_IMAGE" = true ]; then
  TAG="govee-light-manager:ci-${SHA:0:12}"
  NAME="glm-ci-${SHA:0:12}"
  echo "==> Building $TAG from the same checkout"
  docker build -t "$TAG" "$WORK"

  stop_container() { docker rm -f "$NAME" >/dev/null 2>&1 || true; cleanup; }
  trap stop_container EXIT

  echo "==> Smoke testing the image with the same hardening as docker-compose.yml"
  docker run -d --name "$NAME" --read-only --tmpfs /tmp \
    --cap-drop ALL --security-opt no-new-privileges:true \
    -v "glm-ci-data-${SHA:0:12}:/data" "$TAG" >/dev/null

  for _ in $(seq 1 30); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo none)"
    [ "$status" = "healthy" ] && break
    if ! docker exec "$NAME" node -e "fetch('http://127.0.0.1:8787/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      sleep 1
      continue
    fi
    echo "    health endpoint answers"
    break
  done

  docker exec "$NAME" node -e "
    (async () => {
      const base = 'http://127.0.0.1:8787';
      const health = await fetch(base + '/api/v1/health').then((r) => r.json());
      if (health.status !== 'ok' || health.scheduler !== 'running') throw new Error(JSON.stringify(health));
      const page = await fetch(base + '/');
      if (!page.ok || !(await page.text()).includes('id=\"root\"')) throw new Error('frontend not served');
      const blocked = await fetch(base + '/api/v1/devices');
      if (blocked.status !== 401) throw new Error('auth not enforced: ' + blocked.status);
      const session = await fetch(base + '/api/v1/auth/session').then((r) => r.json());
      if (!session.setupRequired || !session.setupCodeRequired) throw new Error('setup code not required in container');
      console.log('    health, frontend, auth and setup-code checks passed');
    })().catch((e) => { console.error(e); process.exit(1); });
  "
  if ! docker logs "$NAME" 2>&1 | grep -q setupCodeForFirstRun; then
    echo "Setup code was not logged" >&2
    exit 1
  fi
  docker rm -f "$NAME" >/dev/null
  docker volume rm "glm-ci-data-${SHA:0:12}" >/dev/null
  echo "==> Image smoke test passed"
fi

echo "==> CI passed for $SHA"
