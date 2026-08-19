import { createServer } from "node:http";
import { SUPPORTED_SCENARIOS, transportFailureFor, latencyMsFor } from "./scenarios.mjs";
import { providers, findProviderByMountPath, findProviderBySlug } from "./providers/index.mjs";

const port = Number(process.env.MOCK_PROVIDERS_PORT ?? 4010);
const defaultLatencyMs = Number(process.env.MOCK_PROVIDERS_DEFAULT_LATENCY_MS ?? 300);
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

function scenarioFor(req, body) {
  const headerScenario = req.headers["x-mock-scenario"];
  if (typeof headerScenario === "string" && headerScenario) return headerScenario;
  if (typeof body.scenario === "string" && body.scenario) return body.scenario;
  return activeScenario;
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
    return send(res, 200, { ...moduleHealth(provider), activeScenario });
  }

  if (pathname === "/mock/scenarios" && req.method === "GET") {
    return send(res, 200, { activeScenario, scenarios: SUPPORTED_SCENARIOS });
  }

  if (pathname === "/mock/reset" && req.method === "POST") {
    activeScenario = "happy_path";
    return send(res, 200, { ok: true, activeScenario });
  }

  const body = await readBody(req);
  const scenario = scenarioFor(req, body);

  if (pathname === "/mock/scenarios/active" && req.method === "POST") {
    if (!SUPPORTED_SCENARIOS.includes(scenario)) {
      return send(res, 400, { ok: false, error: "UNKNOWN_SCENARIO", scenario });
    }
    activeScenario = scenario;
    return send(res, 200, { ok: true, activeScenario });
  }

  const provider = findProviderByMountPath(pathname);
  if (!provider) return send(res, 404, { status: "NOT_FOUND", path: pathname });

  const latencyMs = latencyMsFor(scenario, req.headers["x-mock-latency-ms"], defaultLatencyMs);
  if (scenario === "timeout") {
    await new Promise((resolve) => setTimeout(resolve, latencyMs + 9_000));
  } else {
    await new Promise((resolve) => setTimeout(resolve, latencyMs));
  }

  if (scenario === "invalid_payload") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("{ invalid-json");
  }

  const transportFailure = transportFailureFor(scenario);
  if (transportFailure) return send(res, transportFailure.statusCode, transportFailure.payload);

  return send(res, 200, provider.respond(scenario, body.input ?? {}));
}

createServer((req, res) => {
  handle(req, res).catch((error) => {
    send(res, 500, { status: "MOCK_SERVER_ERROR", error: error instanceof Error ? error.message : "Unknown" });
  });
}).listen(port, () => {
  console.log(`[atlas-external-providers-mock-server] listening on http://localhost:${port}`);
  console.log(`  modules: ${providers.map((provider) => provider.slug).join(", ")}`);
});
