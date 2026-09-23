/**
 * Enrutado por método y path EXACTO.
 *
 * Los hallazgos H04 y H05 del paquete QA vienen los dos de aquí. El emulador buscaba proveedor con
 * `pathname.startsWith(provider.mountPath + "/")` y no miraba el método, así que:
 *
 *   POST /mock/segip/nonexistent        → 200 FOUND   (ruta que no existe)
 *   GET  /mock/segip/identity/verify    → 200 FOUND   (método que el proveedor no expone)
 *
 * Las dos son mentiras que un test se cree. Una suite de contrato apuntando a un endpoint que el
 * proveedor real no tiene pasaba en verde, y el fallo aparecía recién contra el proveedor de
 * producción. Ahora la tabla de rutas es explícita: o coincide método y path, o es 404; y si el
 * path existe con otro método, es 405 con `Allow` —que es lo que un cliente HTTP necesita para
 * distinguir "no existe" de "no así".
 *
 * Un `:param` en el patrón captura un segmento (se usa en `/mock/control/runs/:runId/reset`).
 */

function compile(pattern) {
  const segments = pattern.split("/").filter((segment) => segment !== "");
  return {
    pattern,
    segments,
    hasParams: segments.some((segment) => segment.startsWith(":")),
  };
}

export function route(method, pattern, handler, meta = {}) {
  return { method: method.toUpperCase(), handler, meta, ...compile(pattern) };
}

function matchSegments(compiled, parts) {
  if (compiled.segments.length !== parts.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i += 1) {
    const expected = compiled.segments[i];
    if (expected.startsWith(":")) {
      if (parts[i] === "") return null;
      params[expected.slice(1)] = decodeURIComponent(parts[i]);
      continue;
    }
    if (expected !== parts[i]) return null;
  }
  return params;
}

/**
 * @returns {{kind:'match', route, params} | {kind:'method_not_allowed', allow: string[]} | {kind:'not_found'}}
 */
export function resolve(routes, method, pathname) {
  const parts = pathname.split("/").filter((segment) => segment !== "");
  const pathMatches = [];
  for (const candidate of routes) {
    const params = matchSegments(candidate, parts);
    if (params === null) continue;
    pathMatches.push(candidate);
    if (candidate.method === method.toUpperCase())
      return { kind: "match", route: candidate, params };
  }
  if (pathMatches.length > 0) {
    const allow = [
      ...new Set(pathMatches.map((candidate) => candidate.method)),
    ].sort();
    // HEAD lo sirve Node sobre el GET; declararlo evita que un cliente lo descarte de antemano.
    if (allow.includes("GET") && !allow.includes("HEAD")) allow.push("HEAD");
    return { kind: "method_not_allowed", allow: allow.sort() };
  }
  return { kind: "not_found" };
}
