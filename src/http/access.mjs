/**
 * Quién puede hablar con el emulador desde un navegador, y quién puede cambiar su estado.
 *
 * Hasta 9fdecd5 el CORS reflejaba CUALQUIER `Origin` con `Access-Control-Allow-Credentials: true`,
 * y `POST /mock/scenarios/active` y `POST /mock/reset` no pedían nada. La justificación era que el
 * emulador "nunca se publica a internet". En TEST se publicó (dominio de Coolify), y con eso
 * cualquier página podía leer sus respuestas y cualquiera podía tumbar el tráfico legacy de
 * AtlasBackend con un `provider_down`. Aquí las dos cosas dejan de depender de dónde vive.
 */
import { timingSafeEqual } from "node:crypto";
import { sendError } from "./respond.mjs";

/* ------------------------------------------------------------------- CORS */

/** Orígenes de desarrollo: el portal en `localhost:5273` contra el emulador en `localhost:4010`. */
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

/**
 * `MOCK_PROVIDERS_CORS_ORIGINS`: lista separada por comas de orígenes exactos
 * (`esquema://host[:puerto]`). Sin variable, sólo los de desarrollo. Con variable, SÓLO los
 * listados —el comodín de desarrollo no se suma solo: si hace falta, se lista—.
 *
 * Devuelve `{ mode: "dev" }` o `{ mode: "list", origins: Set }`. Lanza `Error` con el valor que no
 * es un origen; `loadConfig` lo convierte en `ConfigError`.
 */
export function parseCorsOrigins(raw) {
  if (raw === undefined || raw.trim() === "")
    return Object.freeze({ mode: "dev" });
  const origins = new Set();
  for (const entry of raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`"${entry}" no es un origen (esquema://host[:puerto]).`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error(`"${entry}" no es http ni https.`);
    // Un origen no lleva ruta, query ni credenciales. `https://a.example/` se acepta (la barra final
    // es lo que se pega al copiar de la barra del navegador); `https://a.example/x` no.
    if (
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      entry.replace(/\/$/, "") !== url.origin
    ) {
      throw new Error(
        `"${entry}" no es un origen: sin ruta, sin query, sin comodines.`,
      );
    }
    origins.add(url.origin);
  }
  if (origins.size === 0) return Object.freeze({ mode: "dev" });
  return Object.freeze({ mode: "list", origins });
}

export function isOriginAllowed(allowed, origin) {
  if (typeof origin !== "string" || origin === "") return false;
  if (allowed.mode === "list") return allowed.origins.has(origin);
  return DEV_ORIGIN.test(origin);
}

/**
 * Cabeceras CORS de la respuesta. `Vary: Origin` va SIEMPRE que llegue un Origin: la respuesta
 * depende de él, y una caché intermedia no puede servir la de un origen permitido a otro que no.
 * Un origen no permitido no recibe NINGUNA cabecera CORS: el navegador bloquea la lectura.
 */
export function applyCors(req, res, config) {
  const origin = req.headers.origin;
  if (!origin) return false;
  res.setHeader("Vary", "Origin");
  if (!isOriginAllowed(config.corsOrigins, origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  // Sin esto `response.headers.get("x-atlas-simulated")` da null en el navegador del QA Lab.
  res.setHeader("Access-Control-Expose-Headers", "x-atlas-simulated");
  return true;
}

/* ------------------------------------------------- rutas legacy con efecto */

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const FORWARDING_HEADERS = ["forwarded", "x-forwarded-for", "x-real-ip"];

/**
 * ¿La petición viene de la propia máquina, sin intermediarios?
 *
 * Sólo loopback. Una dirección privada (10/8, 172.16/12, 192.168/16) NO cuenta como interna: bajo
 * Coolify el tráfico de internet llega al contenedor desde el proxy (Traefik), que vive en esa
 * misma red privada. Por dirección no hay forma fiable de separar "AtlasBackend en la red de
 * Coolify" de "cualquiera en internet a través del proxy", así que no se intenta.
 *
 * Y una petición con cabeceras de reenvío tampoco cuenta aunque llegue por loopback: es un proxy en
 * la misma máquina hablando en nombre de otro.
 */
export function isLocalRequest(req) {
  if (FORWARDING_HEADERS.some((name) => req.headers?.[name] !== undefined))
    return false;
  return LOOPBACK.has(req.socket?.remoteAddress);
}

export function bearerMatches(expected, header) {
  const received =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice(7)
      : null;
  if (typeof received !== "string" || received.length !== expected.length)
    return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/**
 * Guarda de `POST /mock/scenarios/active` y `POST /mock/reset`.
 *
 * - Con `MOCK_PROVIDERS_CONTROL_TOKEN`: el mismo Bearer que el plano de control, desde donde sea.
 * - Sin token: sólo desde la propia máquina (el `curl localhost:4010` del README). Cualquier otro
 *   origen recibe 403 y cómo habilitarlo; no hay forma de cambiar el estado sin identificarse.
 *
 * Escribe la respuesta de rechazo y devuelve `false`; el llamador sólo sigue si recibe `true`.
 */
export function authorizeLegacyControl(req, res, config) {
  if (config.controlToken) {
    if (bearerMatches(config.controlToken, req.headers.authorization))
      return true;
    sendError(
      res,
      401,
      "CONTROL_UNAUTHORIZED",
      "Esta ruta cambia el estado del emulador: necesita el token de administración.",
    );
    return false;
  }
  if (isLocalRequest(req)) return true;
  sendError(
    res,
    403,
    "LEGACY_CONTROL_LOCAL_ONLY",
    "Sin MOCK_PROVIDERS_CONTROL_TOKEN esta ruta sólo acepta peticiones desde la propia máquina. Configure el token y envíelo como Bearer.",
  );
  return false;
}
