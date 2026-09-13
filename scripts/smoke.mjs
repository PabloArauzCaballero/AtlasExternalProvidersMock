/**
 * Humo del emulador: arranca el servidor de verdad en un puerto libre y comprueba lo que sus
 * consumidores dan por hecho. No simula nada: si esto pasa, AtlasBackend y el tablero del portal
 * tienen a quién preguntar.
 *
 *   node scripts/smoke.mjs
 *
 * Qué afirma:
 * - `/mock/health` responde y enumera tantos módulos como el catálogo.
 * - Cada proveedor del catálogo contesta en su propia `healthPath`.
 * - Un proveedor inexistente es un 404 con `UNKNOWN_MODULE`, no un 200 que parezca sano.
 * - El catálogo no está vacío y cada operación declara su ruta completa bajo `/mock`.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../src/server.mjs", import.meta.url));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitUntilListening(base, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`el servidor terminó al arrancar con código ${child.exitCode}`);
    try {
      const res = await fetch(`${base}/mock/health`);
      if (res.ok) return;
    } catch {
      // todavía no escucha
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`el servidor no respondió en ${timeoutMs} ms`);
}

const failures = [];
function check(condition, message) {
  if (condition) console.log(`  ok   ${message}`);
  else {
    console.log(`  FAIL ${message}`);
    failures.push(message);
  }
}

async function getJson(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [serverPath], {
  env: { ...process.env, MOCK_PROVIDERS_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (d) => (output += d));
child.stderr.on("data", (d) => (output += d));

try {
  await waitUntilListening(base, child);

  const health = await getJson(base, "/mock/health");
  check(health.status === 200 && health.body?.ok === true, "/mock/health responde ok");

  const catalog = await getJson(base, "/mock/providers");
  const providers = catalog.body?.providers ?? [];
  check(catalog.status === 200 && providers.length > 0, `el catálogo publica proveedores (${providers.length})`);
  check(
    (health.body?.modules ?? []).length === providers.length,
    "el health global enumera los mismos módulos que el catálogo",
  );

  for (const provider of providers) {
    const res = await getJson(base, provider.healthPath);
    check(res.status === 200 && res.body?.ok === true, `${provider.code}: ${provider.healthPath}`);
    const badPaths = (provider.operations ?? []).filter((op) => !op.fullPath?.startsWith("/mock/"));
    check(badPaths.length === 0, `${provider.code}: todas sus operaciones cuelgan de /mock`);
  }

  const unknown = await getJson(base, "/mock/health/no-existe");
  check(
    unknown.status === 404 && unknown.body?.error === "UNKNOWN_MODULE",
    "un proveedor inexistente es 404 UNKNOWN_MODULE",
  );
} catch (error) {
  failures.push(error.message);
  console.log(`  FAIL ${error.message}\n${output}`);
} finally {
  child.kill();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} comprobación(es) fallida(s).`);
  process.exit(1);
}
console.log("\nEmulador sano.");
