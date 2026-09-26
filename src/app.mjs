/**
 * `createMockServer(config)`: el emulador como función, no como efecto de importar un archivo.
 *
 * Antes `src/server.mjs` leía `process.env`, construía el servidor y llamaba a `listen()` en el
 * cuerpo del módulo. Consecuencia práctica: no había forma de arrancar dos instancias con
 * configuraciones distintas dentro de un test, ni de probar el enrutado sin abrir un puerto. Por
 * eso el repo no tenía suite —sólo un humo que lanzaba un proceso hijo— y por eso la documentación
 * de AtlasBackend prometía un `test/contract.test.mjs` que no existía.
 *
 * Aquí la fábrica devuelve `{ server, config, store }` sin escuchar. El entrypoint escucha; los
 * tests piden puerto 0 y hablan HTTP de verdad contra su propia instancia.
 */
import { createServer } from "node:http";
import { providers, findProviderBySlug } from "./providers/index.mjs";
import {
  SUPPORTED_SCENARIOS,
  transportFailureFor,
  backgroundFailureFor,
  latencyMsFor,
} from "./scenarios.mjs";
import {
  SCHEMA_VERSION,
  providerCatalog,
  isKnownScenario,
  supportsScenario,
  scenariosSupportedBy,
  operationsOf,
} from "./capabilities.mjs";
import { readJsonBody } from "./http/body.mjs";
import {
  sendJson,
  sendError,
  sendRaw,
  SIMULATED_HEADER,
} from "./http/respond.mjs";
import { applyCors, authorizeLegacyControl } from "./http/access.mjs";
import { delay } from "./http/delay.mjs";
import { route, resolve as resolveRoute } from "./http/router.mjs";
import {
  createNamespaceStore,
  transitionEntity,
  readEntity,
  rememberIdempotent,
  nextAttempt,
} from "./runtime/namespaces.mjs";
import { resolveScenario } from "./runtime/fault-plan.mjs";
import {
  readContext,
  authorizeContext,
  traceIdOf,
} from "./runtime/context.mjs";
import { redact, payloadHash } from "./runtime/journal.mjs";
import { controlRoutes, authorize } from "./control/routes.mjs";
import { createInbox, inboxRoutes } from "./control/inbox.mjs";

export function createMockServer(config, { logger = console } = {}) {
  const store = createNamespaceStore({
    maxNamespaces: config.maxNamespaces,
    ttlMs: config.namespaceTtlMs,
    journalMaxEntries: config.journalMaxEntries,
    defaultScenario: config.defaultScenario,
  });

  // Buzón QA de notificaciones: el backend entrega aquí en modo `webhook` y el motor QA lee los códigos.
  const inbox = createInbox();
  const routes = [
    ...healthRoutes(store, config),
    ...controlRoutes(store, config),
    ...inboxRoutes(inbox, authorize),
    ...providerRoutes(store),
  ];

  const server = createServer((req, res) => {
    handle(req, res, routes, config, logger).catch((error) => {
      // El detalle interno va al log, no al cliente: un emulador que devuelve su propio stack es
      // una fuga gratuita, y un `catch` que intenta escribir sobre una respuesta ya cerrada tumba
      // el proceso. `sendError` comprueba las dos cosas.
      logger.error?.(
        JSON.stringify({
          level: "error",
          event: "unhandled",
          path: req.url,
          message: error?.message,
        }),
      );
      sendError(
        res,
        500,
        "MOCK_SERVER_ERROR",
        "El emulador no pudo atender la petición.",
      );
    });
  });

  return { server, config, store, routes };
}

function isPreflight(req) {
  return (req.method ?? "GET").toUpperCase() === "OPTIONS";
}

/**
 * Preflight. Un origen no admitido recibe un 204 SIN cabeceras CORS (`applyCors` no las puso), y el
 * navegador corta ahí. Uno admitido recibe métodos y las cabeceras que pidió.
 */
function handlePreflight(req, res, corsAllowed) {
  if (!corsAllowed) {
    res.writeHead(204, { [SIMULATED_HEADER]: "true" });
    return res.end();
  }
  const requestedHeaders = req.headers["access-control-request-headers"];
  res.writeHead(204, {
    [SIMULATED_HEADER]: "true",
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": requestedHeaders || "*",
    "Access-Control-Max-Age": "600",
  });
  res.end();
}

async function handle(req, res, routes, config, logger) {
  // La marca va antes que nada: cualquier salida posterior —incluida una que no pase por
  // `sendJson`— la hereda.
  res.setHeader(SIMULATED_HEADER, "true");
  const corsAllowed = applyCors(req, res, config);
  if (isPreflight(req)) return handlePreflight(req, res, corsAllowed);

  let pathname;
  try {
    pathname = new URL(req.url ?? "/", "http://mock.invalid").pathname;
  } catch {
    return sendError(
      res,
      400,
      "INVALID_REQUEST_TARGET",
      "La URL de la petición no es válida.",
    );
  }

  const match = resolveRoute(routes, req.method ?? "GET", pathname);
  if (match.kind === "not_found") {
    return sendError(
      res,
      404,
      "ROUTE_NOT_FOUND",
      "Este emulador no expone esa ruta.",
      { path: pathname, method: req.method },
    );
  }
  if (match.kind === "method_not_allowed") {
    // 405 + Allow, no 404: la diferencia es lo que deja a un consumidor corregir la llamada en vez
    // de concluir que el proveedor no existe.
    return sendError(
      res,
      405,
      "METHOD_NOT_ALLOWED",
      `Esa ruta existe, pero no con ${req.method}.`,
      { allow: match.allow },
      { allow: match.allow.join(", ") },
    );
  }
  return match.route.handler({
    req,
    res,
    params: match.params,
    url: new URL(req.url ?? "/", "http://mock.invalid"),
    config,
    logger,
  });
}

/* ------------------------------------------------------------------ salud */

function moduleHealth(provider) {
  return {
    code: provider.code,
    slug: provider.slug,
    path: `${provider.mountPath}${provider.operationPath}`,
    status: "UP",
  };
}

/**
 * Liveness y readiness separados, que es la corrección que pide el paquete QA: "un proceso vivo no
 * implica que un proveedor esté UP". `/mock/live` dice que el proceso atiende. `/mock/ready` dice
 * que además el catálogo está completo y coherente —ocho módulos, cada uno con rutas bajo `/mock` y
 * escenarios declarados—, que es lo que un orquestador necesita para mandar tráfico.
 *
 * `/mock/health` se conserva con su forma anterior porque AtlasBackend lo consume hoy.
 */
function healthRoutes(store, config) {
  const readiness = () => {
    const problems = [];
    for (const provider of providers) {
      const operations = operationsOf(provider);
      if (operations.length === 0)
        problems.push(`${provider.code} no declara operaciones.`);
      if (
        operations.some((operation) => !operation.fullPath.startsWith("/mock/"))
      )
        problems.push(`${provider.code} declara una operación fuera de /mock.`);
      if (typeof provider.respond !== "function")
        problems.push(`${provider.code} no expone respond().`);
      if (scenariosSupportedBy(provider).length === 0)
        problems.push(`${provider.code} no soporta ningún escenario.`);
    }
    return problems;
  };

  return [
    route("GET", "/mock/live", ({ res }) =>
      sendJson(res, 200, {
        ok: true,
        status: "LIVE",
        epoch: store.epoch,
        schemaVersion: SCHEMA_VERSION,
      }),
    ),

    route("GET", "/mock/version", ({ res }) =>
      sendJson(res, 200, {
        service: "atlas-external-providers-mock-server",
        version: config.appVersion,
        commit: config.commit,
        environment: process.env.NODE_ENV ?? "unknown",
      }),
    ),

    route("GET", "/mock/ready", ({ res }) => {
      const problems = readiness();
      return sendJson(res, problems.length === 0 ? 200 : 503, {
        ok: problems.length === 0,
        status: problems.length === 0 ? "READY" : "NOT_READY",
        epoch: store.epoch,
        schemaVersion: SCHEMA_VERSION,
        providers: providers.length,
        namespaces: store.stats(),
        problems,
      });
    }),

    route("GET", "/mock/health", ({ res }) =>
      sendJson(res, 200, {
        ok: true,
        schemaVersion: SCHEMA_VERSION,
        epoch: store.epoch,
        activeScenario: store.resolve({}).namespace.scenarioProfile,
        scenarios: SUPPORTED_SCENARIOS,
        modules: providers.map(moduleHealth),
      }),
    ),

    route("GET", "/mock/health/:slug", ({ res, params }) => {
      const provider = findProviderBySlug(params.slug);
      if (!provider)
        return sendError(
          res,
          404,
          "UNKNOWN_MODULE",
          "El emulador no expone ese módulo.",
          { slug: params.slug },
        );
      return sendJson(res, 200, {
        ok: true,
        ...moduleHealth(provider),
        schemaVersion: SCHEMA_VERSION,
      });
    }),

    route("GET", "/mock/providers", ({ res }) => {
      const catalog = providerCatalog();
      return sendJson(res, 200, {
        schemaVersion: SCHEMA_VERSION,
        activeScenario: store.resolve({}).namespace.scenarioProfile,
        backgroundErrorRate: config.backgroundErrorRate,
        strictScenarios: config.strictScenarios,
        count: catalog.length,
        scenarios: SUPPORTED_SCENARIOS,
        providers: catalog,
      });
    }),

    route("GET", "/mock/scenarios", ({ res }) =>
      sendJson(res, 200, {
        schemaVersion: SCHEMA_VERSION,
        activeScenario: store.resolve({}).namespace.scenarioProfile,
        scenarios: SUPPORTED_SCENARIOS,
      }),
    ),

    /**
     * Legacy, y deliberadamente acotado: cambia el escenario del namespace legacy y de NINGÚN otro.
     * Antes movía una variable global y con ella el comportamiento de todas las corridas a la vez
     * (hallazgo H03). Una corrida nueva fija su escenario al darse de alta.
     *
     * Con efecto, así que autenticada (TSK-MOCK-01): el namespace legacy es el que usa AtlasBackend,
     * y un anónimo que alcanzara el emulador podía ponerle `provider_down`. La guarda va ANTES de
     * leer el cuerpo. Ver `authorizeLegacyControl` para el caso sin token.
     */
    route(
      "POST",
      "/mock/scenarios/active",
      async ({ req, res, config: cfg }) => {
        if (!authorizeLegacyControl(req, res, cfg)) return undefined;
        const body = await readJsonBody(req, { maxBytes: cfg.maxBodyBytes });
        if (!body.ok)
          return body.aborted
            ? undefined
            : sendError(res, body.status, body.code, body.detail);
        const scenario =
          typeof body.value.scenario === "string"
            ? body.value.scenario
            : req.headers["x-mock-scenario"];
        if (!isKnownScenario(scenario))
          return sendError(
            res,
            400,
            "UNKNOWN_SCENARIO",
            "Ese escenario no existe.",
            { scenario: scenario ?? null, scenarios: SUPPORTED_SCENARIOS },
          );
        const legacy = store.resolve({}).namespace;
        legacy.scenarioProfile = scenario;
        return sendJson(res, 200, {
          ok: true,
          scope: "legacy",
          activeScenario: legacy.scenarioProfile,
        });
      },
    ),

    route("POST", "/mock/reset", ({ req, res, config: cfg }) => {
      if (!authorizeLegacyControl(req, res, cfg)) return undefined;
      const legacy = store.resolve({}).namespace;
      store.reset(legacy);
      legacy.scenarioProfile = config.defaultScenario;
      // El alcance se dice en la respuesta: un operador tiene que saber que esto NO tocó las
      // corridas activas, que era justo lo que el reset global rompía.
      return sendJson(res, 200, {
        ok: true,
        scope: "legacy",
        activeScenario: legacy.scenarioProfile,
        note: "Las corridas con namespace propio no se tocan.",
      });
    }),
  ];
}

/* -------------------------------------------------------------- proveedores */

function providerRoutes(store) {
  const built = [];
  for (const provider of providers) {
    for (const operation of operationsOf(provider)) {
      built.push(
        route(
          operation.method,
          operation.fullPath,
          (ctx) => handleProviderCall({ ...ctx, provider, operation, store }),
          {
            provider: provider.code,
            operation: operation.path,
          },
        ),
      );
    }
  }
  return built;
}

function latencyFor(req, scenario, provider, config) {
  const raw = req.headers["x-mock-latency-ms"];
  if (typeof raw === "string" && raw.trim() !== "") {
    const value = Number(raw);
    // Un `x-mock-latency-ms: 1e9` no es una prueba de cola larga: es un cuelgue con otro nombre.
    if (!Number.isFinite(value) || value < 0)
      return {
        ok: false,
        detail: `x-mock-latency-ms tiene que ser un número ≥ 0; llegó "${raw}".`,
      };
    if (value > config.maxLatencyMs)
      return {
        ok: false,
        detail: `x-mock-latency-ms (${value}) supera el techo configurado (${config.maxLatencyMs}).`,
      };
    return { ok: true, ms: value, intended: value };
  }
  const ms = latencyMsFor(scenario, provider, config.defaultLatencyMs);
  return { ok: true, ms: Math.min(ms, config.maxLatencyMs), intended: ms };
}

async function handleProviderCall({
  req,
  res,
  provider,
  operation,
  store,
  config,
  logger,
}) {
  const startedAt = Date.now();
  const body = await readJsonBody(req, { maxBytes: config.maxBodyBytes });
  if (!body.ok) {
    if (body.aborted) return undefined; // el cliente se fue: no hay a quién contestar
    // Con un cuerpo rechazado queda entrada sin consumir: `connection: close` evita que el resto
    // del cuerpo se interprete como la siguiente petición del keep-alive.
    return sendError(
      res,
      body.status,
      body.code,
      body.detail,
      {},
      body.status === 413 ? { connection: "close" } : {},
    );
  }

  const context = readContext(req, body.value);
  const authorized = authorizeContext(store, context);
  if (!authorized.ok)
    return sendError(
      res,
      authorized.status,
      authorized.code,
      authorized.detail,
    );
  const namespace = authorized.namespace;
  namespace.requestCount += 1;

  const explicitHeader =
    typeof req.headers["x-mock-scenario"] === "string"
      ? req.headers["x-mock-scenario"].trim()
      : "";
  const explicitBody =
    typeof body.value.scenario === "string" ? body.value.scenario.trim() : "";
  const explicitScenario = explicitHeader || explicitBody || null;

  // Se valida ANTES de resolver precedencias: un escenario que no existe es un error del
  // consumidor, y devolverle el caso feliz (hallazgo H06) es convertir su error en un PASS.
  if (explicitScenario && !isKnownScenario(explicitScenario)) {
    return sendError(
      res,
      400,
      "UNKNOWN_SCENARIO",
      "Ese escenario no existe en este emulador.",
      {
        scenario: explicitScenario,
        scenarios: SUPPORTED_SCENARIOS,
      },
    );
  }

  const operationKey = `${provider.slug}|${operation.path}|${context.personaKey ?? "-"}|${context.logicalOperationId ?? "-"}`;
  const attempt =
    context.declaredAttempt ?? nextAttempt(namespace, operationKey);

  const decision = resolveScenario({
    plan: namespace.faultPlan,
    context: {
      provider: provider.slug,
      operation: operation.path,
      personaKey: context.personaKey,
      logicalOperationId: context.logicalOperationId,
    },
    attempt,
    explicitScenario,
    runProfileScenario: namespace.scenarioProfile,
    serverDefault: config.defaultScenario,
  });
  const scenario = decision.scenario;

  if (config.strictScenarios && !supportsScenario(provider, scenario)) {
    journal(namespace, {
      type: "rejected",
      provider: provider.code,
      scenario,
      reason: "SCENARIO_NOT_SUPPORTED_BY_PROVIDER",
      context,
      operation: operation.path,
      statusCode: 422,
    });
    return sendError(
      res,
      422,
      "SCENARIO_NOT_SUPPORTED_BY_PROVIDER",
      `${provider.code} no sabe representar "${scenario}".`,
      {
        provider: provider.code,
        scenario,
        supportedScenarios: scenariosSupportedBy(provider),
        source: decision.source,
      },
    );
  }

  const latency = latencyFor(req, scenario, provider, config);
  if (!latency.ok)
    return sendError(res, 400, "INVALID_LATENCY_HEADER", latency.detail);

  const waitMs =
    scenario === "timeout"
      ? Math.min(
          latency.ms + config.timeoutExtraMs,
          config.maxLatencyMs + config.timeoutExtraMs,
        )
      : latency.ms;
  const waited = await delay(waitMs, res);
  if (waited.aborted) {
    // El consumidor abortó —que en `timeout` es EXACTAMENTE lo que se está probando—. Queda en el
    // journal como aborto, no como éxito ni como fallo del proveedor.
    journal(namespace, {
      type: "aborted",
      provider: provider.code,
      scenario,
      context,
      operation: operation.path,
      intendedDelayMs: waitMs,
      actualServiceTimeMs: Date.now() - startedAt,
    });
    return undefined;
  }

  const shared = {
    provider: provider.code,
    scenario,
    scenarioSource: decision.source,
    faultRuleId: decision.ruleId ?? null,
    operation: operation.path,
    attempt,
    context,
    intendedDelayMs: waitMs,
    payloadHash: payloadHash(body.value.input ?? {}),
  };

  if (scenario === "invalid_payload") {
    journal(namespace, {
      ...shared,
      type: "responded",
      statusCode: 200,
      injected: "MALFORMED_JSON",
      actualServiceTimeMs: Date.now() - startedAt,
    });
    // Inyección declarada: JSON sintácticamente roto. Es distinto de un schema inválido, y el
    // journal lo dice para que el informe no mezcle las dos clases de fallo.
    return sendRaw(res, 200, "application/json", "{ invalid-json");
  }

  const transport =
    transportFailureFor(scenario) ??
    backgroundFailureFor(
      config.backgroundErrorRate,
      Boolean(explicitScenario) || decision.source === "fault_plan",
    );
  if (transport) {
    const headers = transport.statusCode === 429 ? { "retry-after": "2" } : {};
    journal(namespace, {
      ...shared,
      type: "responded",
      statusCode: transport.statusCode,
      outcome: transport.payload.status,
      actualServiceTimeMs: Date.now() - startedAt,
    });
    return sendJson(
      res,
      transport.statusCode,
      { ...transport.payload, schemaVersion: SCHEMA_VERSION },
      headers,
    );
  }

  const idempotent = rememberIdempotent(
    namespace,
    {
      principal: context.personaKey,
      operation: `${provider.slug}${operation.path}`,
      key: context.idempotencyKey,
    },
    body.value.input ?? {},
    () =>
      provider.respond(scenario, body.value.input ?? {}, operation.path, {
        personaKey: context.personaKey,
        attempt,
        entity: readEntity(namespace, {
          personaKey: context.personaKey,
          provider: provider.slug,
          entityKey: operation.path,
        }),
        setEntity: (next) =>
          transitionEntity(
            namespace,
            {
              personaKey: context.personaKey,
              provider: provider.slug,
              entityKey: operation.path,
            },
            () => next,
          ),
      }),
  );

  if (idempotent.kind === "mismatch") {
    journal(namespace, {
      ...shared,
      type: "responded",
      statusCode: 422,
      outcome: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY",
    });
    return sendError(
      res,
      422,
      "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_BODY",
      "Esa clave de idempotencia ya se usó con otro cuerpo.",
      {
        storedPayloadHash: idempotent.storedHash,
        receivedPayloadHash: idempotent.receivedHash,
      },
    );
  }

  const payload = { ...idempotent.result, schemaVersion: SCHEMA_VERSION };
  journal(namespace, {
    ...shared,
    type: "responded",
    statusCode: 200,
    outcome: payload.status ?? null,
    idempotency: idempotent.kind,
    actualServiceTimeMs: Date.now() - startedAt,
  });
  logger.debug?.(
    JSON.stringify({
      level: "debug",
      event: "provider_call",
      provider: provider.code,
      scenario,
      attempt,
      runId: context.runId ?? null,
    }),
  );
  return sendJson(
    res,
    200,
    idempotent.kind === "replay"
      ? { ...payload, idempotentReplay: true }
      : payload,
  );
}

function journal(namespace, entry) {
  const { context = {}, ...rest } = entry;
  namespace.journal.append({
    ...rest,
    runId: context.runId ?? null,
    personaKey: context.personaKey ?? null,
    logicalOperationId: context.logicalOperationId ?? null,
    traceId: traceIdOf(context) ?? null,
    safeInput: entry.safeInput ? redact(entry.safeInput) : undefined,
  });
}
