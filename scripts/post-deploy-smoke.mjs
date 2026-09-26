#!/usr/bin/env node
/** Corre dentro del contenedor: el mock no publica dominio ni puerto del host. */
const sha = process.env.APP_COMMIT_SHA;
if (!/^[a-f0-9]{40}$/i.test(sha ?? '')) throw new Error('APP_COMMIT_SHA ausente o inválido.');
const base = process.env.SMOKE_BASE_URL ?? `http://127.0.0.1:${process.env.MOCK_PROVIDERS_PORT || 4010}`;

async function get(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const live = await get('/mock/live');
if (live.status !== 'LIVE' || live.ok !== true) throw new Error('Liveness no reporta LIVE.');
const ready = await get('/mock/ready');
if (ready.status !== 'READY' || ready.ok !== true || ready.providers < 1) throw new Error('Readiness degradado.');
const health = await get('/mock/health');
if (health.ok !== true || health.modules?.length !== ready.providers) throw new Error('Catálogo de proveedores incompleto.');
const version = await get('/mock/version');
if (version.service !== 'atlas-external-providers-mock-server' || version.version === 'unknown' || version.commit !== sha) {
  throw new Error(`SHA o versión servida incorrecta: ${JSON.stringify(version)}`);
}
console.log(`Smoke interno OK: ${ready.providers} proveedores; commit ${sha}.`);
