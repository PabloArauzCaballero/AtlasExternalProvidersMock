/**
 * Exposición del emulador (plan de producción, TSK-MOCK-01 y TSK-MOCK-02).
 *
 * El mock de TEST quedó publicado a internet por el dominio que Coolify le asignó, y con eso dos
 * cosas que el código daba por seguras porque "nunca se publica" dejaron de serlo:
 *
 * - `POST /mock/scenarios/active` y `POST /mock/reset` no pedían nada: cualquiera podía poner
 *   `provider_down` en el tráfico legacy, que es el que usa AtlasBackend.
 * - El CORS reflejaba cualquier `Origin` con credenciales: cualquier página podía leer respuestas.
 *
 * Y una tercera, de otra naturaleza: nada en la respuesta decía que era simulada. Un destino mal
 * configurado no se distinguía de un proveedor real por el contenido.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { networkInterfaces } from "node:os";
import { startMock, CONTROL_TOKEN } from "./helpers.mjs";
import { providers } from "../src/providers/index.mjs";
import { operationsOf } from "../src/capabilities.mjs";
import { isLocalRequest, parseCorsOrigins, isOriginAllowed } from "../src/http/access.mjs";
import { loadConfig, ConfigError } from "../src/config.mjs";

const BEARER = { authorization: `Bearer ${CONTROL_TOKEN}` };

describe("rutas legacy con efecto: con token configurado exigen el Bearer", () => {
  let mock;
  before(async () => {
    mock = await startMock();
  });
  after(async () => mock.close());

  test("POST /mock/reset sin token → 401 y el estado no cambia", async () => {
    const set = await mock.post("/mock/scenarios/active", { scenario: "provider_down" }, BEARER);
    assert.equal(set.status, 200);

    const anonymous = await mock.post("/mock/reset", {});
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.error, "CONTROL_UNAUTHORIZED");
    assert.equal(mock.store.resolve({}).namespace.scenarioProfile, "provider_down", "el reset anónimo no tocó nada");
  });

  test("POST /mock/reset con un token equivocado → 401", async () => {
    const wrong = await mock.post("/mock/reset", {}, { authorization: "Bearer token-que-no-es-el-bueno" });
    assert.equal(wrong.status, 401);
    assert.equal(mock.store.resolve({}).namespace.scenarioProfile, "provider_down");
  });

  test("POST /mock/reset con token → 200 y vuelve al escenario por defecto", async () => {
    const reset = await mock.post("/mock/reset", {}, BEARER);
    assert.equal(reset.status, 200);
    assert.equal(reset.body.activeScenario, "happy_path");
    assert.equal(mock.store.resolve({}).namespace.scenarioProfile, "happy_path");
  });

  test("POST /mock/scenarios/active sin token → 401 y el escenario no cambia", async () => {
    const anonymous = await mock.post("/mock/scenarios/active", { scenario: "provider_down" });
    assert.equal(anonymous.status, 401);
    assert.equal(mock.store.resolve({}).namespace.scenarioProfile, "happy_path");
  });

  test("la autorización va ANTES de leer el cuerpo: un anónimo no averigua qué escenarios existen", async () => {
    const anonymous = await mock.post("/mock/scenarios/active", { scenario: "no-existe" });
    assert.equal(anonymous.status, 401);
  });
});

describe("rutas legacy con efecto: sin token configurado, sólo desde la propia máquina", () => {
  let mock;
  before(async () => {
    mock = await startMock({ MOCK_PROVIDERS_CONTROL_TOKEN: "" });
  });
  after(async () => mock.close());

  test("desde loopback se permite (el flujo de desarrollo local)", async () => {
    const set = await mock.post("/mock/scenarios/active", { scenario: "provider_down" });
    assert.equal(set.status, 200);
    const reset = await mock.post("/mock/reset", {});
    assert.equal(reset.status, 200);
    assert.equal(mock.store.resolve({}).namespace.scenarioProfile, "happy_path");
  });

  test("una petición que pasó por un proxy no cuenta como local aunque llegue por loopback", async () => {
    const proxied = await mock.post("/mock/reset", {}, { "x-forwarded-for": "203.0.113.7" });
    assert.equal(proxied.status, 403);
    assert.equal(proxied.body.error, "LEGACY_CONTROL_LOCAL_ONLY");
  });
});

describe("isLocalRequest", () => {
  const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

  test("loopback IPv4, IPv6 e IPv4 mapeada son locales", () => {
    assert.equal(isLocalRequest(req("127.0.0.1")), true);
    assert.equal(isLocalRequest(req("::1")), true);
    assert.equal(isLocalRequest(req("::ffff:127.0.0.1")), true);
  });

  test("una red privada NO es local: por ahí llega también el proxy de Coolify con tráfico de internet", () => {
    for (const address of ["10.0.1.5", "172.18.0.3", "192.168.1.20", "203.0.113.7", "::ffff:10.0.0.2", undefined]) {
      assert.equal(isLocalRequest(req(address)), false, String(address));
    }
  });

  test("cabeceras de reenvío anulan el loopback", () => {
    assert.equal(isLocalRequest(req("127.0.0.1", { forwarded: "for=203.0.113.7" })), false);
    assert.equal(isLocalRequest(req("127.0.0.1", { "x-real-ip": "203.0.113.7" })), false);
  });
});

describe("rutas legacy: desde una dirección que no es loopback y sin token → 403", () => {
  const external = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry && entry.family === "IPv4" && !entry.internal);

  test("POST /mock/reset por la interfaz de red", { skip: external ? false : "la máquina no tiene interfaz IPv4 externa" }, async () => {
    const { createMockServer } = await import("../src/app.mjs");
    const config = loadConfig({ MOCK_PROVIDERS_PORT: "0", MOCK_PROVIDERS_DEFAULT_LATENCY_MS: "0", MOCK_PROVIDERS_MAX_LATENCY_MS: "0" });
    const { server, store } = createMockServer(config, { logger: { error: () => {}, debug: () => {} } });
    await new Promise((resolve) => server.listen(0, external.address, resolve));
    try {
      store.resolve({}).namespace.scenarioProfile = "provider_down";
      const response = await fetch(`http://${external.address}:${server.address().port}/mock/reset`, { method: "POST" });
      assert.equal(response.status, 403);
      assert.equal(store.resolve({}).namespace.scenarioProfile, "provider_down", "el estado no cambió");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("CORS por lista", () => {
  test("sin variable: sólo orígenes de desarrollo en localhost y 127.0.0.1", () => {
    const allowed = parseCorsOrigins(undefined);
    assert.equal(isOriginAllowed(allowed, "http://localhost:5273"), true);
    assert.equal(isOriginAllowed(allowed, "http://localhost"), true);
    assert.equal(isOriginAllowed(allowed, "http://127.0.0.1:3000"), true);
    assert.equal(isOriginAllowed(allowed, "https://evil.example"), false);
    assert.equal(isOriginAllowed(allowed, "http://localhost.evil.example"), false);
    assert.equal(isOriginAllowed(allowed, "http://161.97.85.216:3020"), false);
    assert.equal(isOriginAllowed(allowed, "null"), false);
  });

  test("con variable: sólo los orígenes listados, sin el comodín de desarrollo", () => {
    const allowed = parseCorsOrigins("http://161.97.85.216:3020, https://pablo-h310.taila8f993.ts.net/");
    assert.equal(isOriginAllowed(allowed, "http://161.97.85.216:3020"), true);
    assert.equal(isOriginAllowed(allowed, "https://pablo-h310.taila8f993.ts.net"), true);
    assert.equal(isOriginAllowed(allowed, "http://localhost:5273"), false);
    assert.equal(isOriginAllowed(allowed, "http://161.97.85.216:3021"), false);
  });

  test("un valor que no es un origen revienta al arrancar", () => {
    for (const bad of ["*", "evil.example", "http://a.example/ruta", "ftp://a.example"]) {
      assert.throws(() => loadConfig({ MOCK_PROVIDERS_CORS_ORIGINS: bad }), ConfigError, bad);
    }
  });

  describe("por HTTP", () => {
    let mock;
    before(async () => {
      mock = await startMock({ MOCK_PROVIDERS_CORS_ORIGINS: "http://portal.example:3020" });
    });
    after(async () => mock.close());

    test("Origin ajeno → sin Access-Control-Allow-Origin ni credenciales", async () => {
      const response = await mock.call("/mock/providers", { headers: { origin: "https://evil.example" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.equal(response.headers.get("access-control-allow-credentials"), null);
      assert.match(response.headers.get("vary") ?? "", /Origin/);
    });

    test("preflight de un Origin ajeno → sin cabeceras CORS", async () => {
      const response = await mock.call("/mock/reset", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization" },
      });
      assert.equal(response.headers.get("access-control-allow-origin"), null);
      assert.equal(response.headers.get("access-control-allow-methods"), null);
    });

    test("Origin listado → ACAO con ese origen, credenciales y la marca legible", async () => {
      const response = await mock.call("/mock/providers", { headers: { origin: "http://portal.example:3020" } });
      assert.equal(response.headers.get("access-control-allow-origin"), "http://portal.example:3020");
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
      assert.match(response.headers.get("access-control-expose-headers") ?? "", /x-atlas-simulated/);
    });

    test("preflight de un Origin listado → 204 con métodos y cabeceras", async () => {
      const response = await mock.call("/mock/segip/identity/verify", {
        method: "OPTIONS",
        headers: { origin: "http://portal.example:3020", "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-mock-scenario" },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), "http://portal.example:3020");
      assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
      assert.equal(response.headers.get("access-control-allow-headers"), "content-type,x-mock-scenario");
    });
  });
});

describe("marca de simulación en toda respuesta", () => {
  let mock;
  before(async () => {
    mock = await startMock();
  });
  after(async () => mock.close());

  const assertMarked = (response, label) => {
    assert.equal(response.headers.get("x-atlas-simulated"), "true", `${label}: cabecera`);
  };

  for (const provider of providers) {
    for (const operation of operationsOf(provider)) {
      test(`${provider.code} ${operation.method} ${operation.fullPath}`, async () => {
        const response = await mock.call(operation.fullPath, {
          method: operation.method,
          headers: { "content-type": "application/json" },
          body: operation.method === "GET" ? undefined : JSON.stringify({ input: {} }),
        });
        assertMarked(response, provider.code);
        assert.equal(response.body?.simulated, true, `${provider.code}: campo en el sobre`);
      });
    }
  }

  test("escenarios genéricos de transporte (503, 401, 429, 500)", async () => {
    for (const scenario of ["provider_down", "unauthorized", "rate_limited", "provider_internal_error"]) {
      const response = await mock.post("/mock/telco/phone-trust/check", { input: {} }, { "x-mock-scenario": scenario });
      assert.ok(response.status >= 400, scenario);
      assertMarked(response, scenario);
      assert.equal(response.body.simulated, true, scenario);
    }
  });

  test("invalid_payload: el cuerpo está roto a propósito, la cabecera no", async () => {
    const response = await mock.post("/mock/telco/phone-trust/check", { input: {} }, { "x-mock-scenario": "invalid_payload" });
    assertMarked(response, "invalid_payload");
  });

  test("errores del emulador (404, 405, 400, 401)", async () => {
    assertMarked(await mock.call("/no-existe"), "404");
    assertMarked(await mock.call("/mock/segip/identity/verify"), "405");
    assertMarked(await mock.post("/mock/segip/identity/verify", { input: {} }, { "x-mock-scenario": "no-existe" }), "400");
    assertMarked(await mock.post("/mock/reset", {}), "401");
  });

  test("salud, catálogo y preflight", async () => {
    for (const path of ["/mock/live", "/mock/ready", "/mock/health", "/mock/health/segip", "/mock/providers", "/mock/scenarios"]) {
      assertMarked(await mock.call(path), path);
    }
    assertMarked(await mock.call("/mock/providers", { method: "OPTIONS", headers: { origin: "http://localhost:5273" } }), "OPTIONS");
  });
});
