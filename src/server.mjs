import { createServer } from "node:http";
import { SUPPORTED_SCENARIOS, transportFailureFor, backgroundFailureFor, latencyMsFor } from "./scenarios.mjs";
import { providers, findProviderByMountPath, findProviderBySlug, operationFromPath, providerCatalog } from "./providers/index.mjs";

const port = Number(process.env.MOCK_PROVIDERS_PORT ?? 4010);
const defaultLatencyMs = Number(process.env.MOCK_PROVIDERS_DEFAULT_LATENCY_MS ?? 300);
const backgroundErrorRate = Number(process.env.MOCK_PROVIDERS_ERROR_RATE ?? 0);
let activeScenario = process.env.MOCK_PROVIDERS_SCENARIO ?? "happy_path";

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function send(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Devuelve además si el escenario vino PEDIDO (cabecera o cuerpo) o si es sólo el activo del
 * servidor. La diferencia importa para el fallo de fondo: una llamada que pidió un escenario es
 * una prueba y no se le mete ruido encima.
 */
function scenarioFor(req, body) {
  const headerScenario = req.headers["x-mock-scenario"];
  if (typeof headerScenario === "string" && headerScenario) return { scenario: headerScenario, explicit: true };
  if (typeof body.scenario === "string" && body.scenario) return { scenario: body.scenario, explicit: true };
  return { scenario: activeScenario, explicit: false };
}

function moduleHealth(provider) {
  return {
    code: provider.code,
    slug: provider.slug,
    path: `${provider.mountPath}${provider.operationPath}`,
    status: "UP",
  };
}

async function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const pathname = url.pathname;

  if (pathname === "/mock/health" && req.method === "GET") {
    return send(res, 200, {
      ok: true,
      activeScenario,
      scenarios: SUPPORTED_SCENARIOS,
      modules: providers.map(moduleHealth),
    });
  }

  if (pathname.startsWith("/mock/health/") && req.method === "GET") {
    const slug = pathname.slice("/mock/health/".length);
    const provider = findProviderBySlug(slug);
    if (!provider) return send(res, 404, { ok: false, error: "UNKNOWN_MODULE", slug });
    return send(res, 200, { ok: true, ...moduleHealth(provider), activeScenario });
  }

  // Catálogo: qué proveedores hay, qué operaciones exponen, cuánto tardan y qué escenarios
  // entiende cada uno. Lo lee el tablero del portal.
  if (pathname === "/mock/providers" && req.method === "GET") {
    const catalog = providerCatalog();
    return send(res, 200, {
      activeScenario,
      backgroundErrorRate,
      count: catalog.length,
      scenarios: SUPPORTED_SCENARIOS,
      providers: catalog,
    });
  }

  if (pathname === "/mock/scenarios" && req.method === "GET") {
    return send(res, 200, { activeScenario, scenarios: SUPPORTED_SCENARIOS });
  }

  if (pathname === "/mock/reset" && req.method === "POST") {
    activeScenario = "happy_path";
    return send(res, 200, { ok: true, activeScenario });
  }

  const body = await readBody(req);
  const { scenario, explicit } = scenarioFor(req, body);

  if (pathname === "/mock/scenarios/active" && req.method === "POST") {
    if (!SUPPORTED_SCENARIOS.includes(scenario)) {
      return send(res, 400, { ok: false, error: "UNKNOWN_SCENARIO", scenario });
    }
    activeScenario = scenario;
    return send(res, 200, { ok: true, activeScenario });
  }

  const provider = findProviderByMountPath(pathname);
  if (!provider) return send(res, 404, { status: "NOT_FOUND", path: pathname });

  const latencyMs = latencyMsFor(scenario, req.headers["x-mock-latency-ms"], defaultLatencyMs, provider);
  if (scenario === "timeout") {
    await new Promise((resolve) => setTimeout(resolve, latencyMs + 9_000));
  } else {
    await new Promise((resolve) => setTimeout(resolve, latencyMs));
  }

  if (scenario === "invalid_payload") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("{ invalid-json");
  }

  const transportFailure = transportFailureFor(scenario) ?? backgroundFailureFor(backgroundErrorRate, explicit);
  if (transportFailure) return send(res, transportFailure.statusCode, transportFailure.payload);

  return send(res, 200, provider.respond(scenario, body.input ?? {}, operationFromPath(provider, pathname)));
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    send(res, 500, { status: "MOCK_SERVER_ERROR", error: error instanceof Error ? error.message : "Unknown" });
  });
}).listen(port, () => {
  console.log(`[atlas-external-providers-mock-server] listening on http://localhost:${port}`);
  console.log(`  modules: ${providers.map((provider) => provider.slug).join(", ")}`);
  if (backgroundErrorRate > 0) console.log(`  background error rate: ${backgroundErrorRate}`);
});
