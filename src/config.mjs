/**
 * Configuración del emulador, validada ANTES de escuchar.
 *
 * Antes cada valor se leía con `Number(process.env.X ?? default)` allí donde hacía falta. Un
 * `MOCK_PROVIDERS_PORT=ochomil` daba `NaN`, y `listen(NaN)` no falla: Node escucha en un puerto
 * efímero. El emulador arrancaba "bien" en un puerto que nadie conocía y los ocho proveedores
 * aparecían caídos en el tablero sin una sola línea de error. Lo mismo con un límite de cuerpo
 * negativo, que dejaba el servidor rechazando todo con 413.
 *
 * Por eso esto es una función pura sobre un objeto de entorno: `createMockServer(config)` la puede
 * usar un test con valores inventados sin tocar `process.env`, y el entrypoint la usa una sola vez
 * y muere con un mensaje concreto si algo no cuadra.
 */
import { parseCorsOrigins } from "./http/access.mjs";
import {
  DEFAULT_BUILD_INFO_URL,
  loadBuildIdentity,
  resolveCommit,
} from "./build-identity.mjs";

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function integer(env, key, fallback, { min, max }) {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value))
    throw new ConfigError(`${key} tiene que ser un entero; llegó "${raw}".`);
  if (value < min || value > max)
    throw new ConfigError(
      `${key} tiene que estar entre ${min} y ${max}; llegó ${value}.`,
    );
  return value;
}

function fraction(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ConfigError(
      `${key} tiene que ser una fracción entre 0 y 1; llegó "${raw}".`,
    );
  }
  return value;
}

function flag(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new ConfigError(`${key} tiene que ser true o false; llegó "${raw}".`);
}

/**
 * El token del plano de control. Sin él, `/mock/control/*` queda APAGADO en vez de abierto: un
 * emulador accesible en una red de pruebas compartida no debe aceptar que cualquiera cree un
 * namespace, plante un plan de fallos y lea el journal de otra corrida.
 */
function controlToken(env) {
  const raw = env.MOCK_PROVIDERS_CONTROL_TOKEN;
  if (raw === undefined || raw === "") return null;
  if (raw.length < 16)
    throw new ConfigError(
      "MOCK_PROVIDERS_CONTROL_TOKEN tiene que tener al menos 16 caracteres.",
    );
  return raw;
}

/**
 * Orígenes de navegador admitidos (TSK-MOCK-01). Sin variable, sólo `http://localhost:*` y
 * `http://127.0.0.1:*`; con variable, sólo los listados. Un valor que no es un origen tumba el
 * arranque: un `*` o una URL con ruta aceptados en silencio dejarían el CORS como antes.
 */
function corsOrigins(env) {
  try {
    return parseCorsOrigins(env.MOCK_PROVIDERS_CORS_ORIGINS);
  } catch (error) {
    throw new ConfigError(`MOCK_PROVIDERS_CORS_ORIGINS: ${error.message}`);
  }
}

export function loadConfig(
  env = process.env,
  buildInfoUrl = DEFAULT_BUILD_INFO_URL,
) {
  const build = loadBuildIdentity(buildInfoUrl);
  const config = {
    port: integer(env, "MOCK_PROVIDERS_PORT", 4010, { min: 0, max: 65_535 }),
    defaultLatencyMs: integer(env, "MOCK_PROVIDERS_DEFAULT_LATENCY_MS", 300, {
      min: 0,
      max: 60_000,
    }),
    /** Techo de `x-mock-latency-ms`. Una cabecera con 10^9 no es una prueba de cola: es un cuelgue. */
    maxLatencyMs: integer(env, "MOCK_PROVIDERS_MAX_LATENCY_MS", 30_000, {
      min: 0,
      max: 300_000,
    }),
    /** Cuánto se suma al retraso pedido para el escenario `timeout`, por encima del deadline del consumidor. */
    timeoutExtraMs: integer(env, "MOCK_PROVIDERS_TIMEOUT_EXTRA_MS", 9_000, {
      min: 0,
      max: 120_000,
    }),
    backgroundErrorRate: fraction(env, "MOCK_PROVIDERS_ERROR_RATE", 0),
    maxBodyBytes: integer(env, "MOCK_PROVIDERS_MAX_BODY_BYTES", 64 * 1024, {
      min: 1_024,
      max: 8 * 1024 * 1024,
    }),
    /**
     * Estricto por defecto: un escenario que este proveedor no sabe representar es un 422 con la
     * lista de los que sí, no un happy path silencioso. Es un cambio de contrato deliberado
     * (hallazgo H06 del paquete QA) y por eso tiene interruptor documentado, no un `if` escondido.
     */
    strictScenarios: flag(env, "MOCK_PROVIDERS_STRICT_SCENARIOS", true),
    defaultScenario: env.MOCK_PROVIDERS_SCENARIO ?? "happy_path",
    controlToken: controlToken(env),
    appVersion: env.APP_VERSION || "2.0.0",
    commit: resolveCommit(build, env.APP_COMMIT_SHA),
    builtAt: build.builtAt,
    corsOrigins: corsOrigins(env),
    /** Namespaces: techo de memoria. El emulador vive en una sola instancia; no puede crecer sin fin. */
    maxNamespaces: integer(env, "MOCK_PROVIDERS_MAX_NAMESPACES", 200, {
      min: 1,
      max: 10_000,
    }),
    namespaceTtlMs: integer(env, "MOCK_PROVIDERS_NAMESPACE_TTL_MS", 3_600_000, {
      min: 60_000,
      max: 86_400_000,
    }),
    journalMaxEntries: integer(
      env,
      "MOCK_PROVIDERS_JOURNAL_MAX_ENTRIES",
      2_000,
      { min: 10, max: 100_000 },
    ),
  };

  if (config.defaultLatencyMs > config.maxLatencyMs) {
    throw new ConfigError(
      `MOCK_PROVIDERS_DEFAULT_LATENCY_MS (${config.defaultLatencyMs}) no puede superar MOCK_PROVIDERS_MAX_LATENCY_MS (${config.maxLatencyMs}).`,
    );
  }
  return Object.freeze(config);
}
