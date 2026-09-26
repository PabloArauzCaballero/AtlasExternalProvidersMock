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
// sharp + libvips + fuentes DENTRO de la imagen: si falta el binario de la plataforma el 200 no
// llega, y el JPEG tiene que abrir con FFD8.
const images = await fetch(`${base}/mock/qa/identity-images`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: 'Bearer ci-control-token-12345',
    'x-mock-tenant-id': 'ci',
  },
  body: JSON.stringify({
    personaKey: 'ci-1',
    firstName: 'Mariela',
    lastName: 'Quispe Mamani',
    documentNumber: '90123456',
    birthDate: '1990-04-12',
  }),
});
assert.equal(images.status, 200);
const drawn = (await images.json()).images;
for (const kind of ['identity_front', 'identity_back', 'selfie']) {
  const bytes = Buffer.from(drawn[kind].base64, 'base64');
  assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8', kind);
}
console.log('Contenedor healthy; mock válido, control sin token rechazado e imágenes QA dibujadas.');
NODE
