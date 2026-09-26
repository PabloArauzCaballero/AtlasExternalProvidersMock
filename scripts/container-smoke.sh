#!/usr/bin/env bash
set -euo pipefail

docker build --file Dockerfile.dev --tag atlas-external-providers-mock:ci .
container="atlas-mock-ci-${GITHUB_RUN_ID:-local}-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

docker run --detach --name "$container" --publish 127.0.0.1:4010:4010 \
  --env MOCK_PROVIDERS_CONTROL_TOKEN=ci-control-token-12345 \
  atlas-external-providers-mock:ci >/dev/null

for _ in $(seq 1 30); do
  state=$(docker inspect --format '{{.State.Health.Status}}' "$container")
  if [ "$state" = healthy ]; then break; fi
  if [ "$state" = unhealthy ]; then
    docker logs "$container"
    exit 1
  fi
  sleep 2
done
test "$(docker inspect --format '{{.State.Health.Status}}' "$container")" = healthy

node --input-type=module <<'NODE'
import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:4010';
const live = await fetch(`${base}/mock/live`);
assert.equal(live.status, 200);
const ready = await fetch(`${base}/mock/ready`);
assert.equal(ready.status, 200);
const valid = await fetch(`${base}/mock/segip/identity/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ scenario: 'happy_path', input: { documentNumber: '1234567' } }),
});
assert.equal(valid.status, 200);
assert.equal((await valid.json()).status, 'FOUND');
const denied = await fetch(`${base}/mock/control/runs`);
assert.equal(denied.status, 401);
assert.equal((await denied.json()).error, 'CONTROL_UNAUTHORIZED');
console.log('Contenedor healthy; mock válido y control sin token rechazado.');
NODE
