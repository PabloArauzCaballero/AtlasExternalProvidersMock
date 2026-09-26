import { readJsonBody } from "../http/body.mjs";
import { sendJson, sendError } from "../http/respond.mjs";
import { route } from "../http/router.mjs";
import { SCHEMA_VERSION } from "../capabilities.mjs";
import {
  fakerCatalog,
  resolveFakerRequest,
  generateFakerBatch,
  fakerRequestFromQuery,
} from "./index.mjs";

function answer(res, type, raw) {
  const resolved = resolveFakerRequest(type, raw);
  if (!resolved.ok) {
    const detail = resolved.errors.map((error) => error.detail).join(" ");
    return sendError(res, resolved.status, resolved.code, detail, {
      errors: resolved.errors,
    });
  }
  return sendJson(res, 200, {
    schemaVersion: SCHEMA_VERSION,
    ...generateFakerBatch(resolved.request),
  });
}

export function fakerRoutes() {
  return [
    route("GET", "/mock/fakers", ({ res }) =>
      sendJson(res, 200, { schemaVersion: SCHEMA_VERSION, ...fakerCatalog() }),
    ),
    route("GET", "/mock/fakers/:type", ({ res, params, url }) =>
      answer(res, params.type, fakerRequestFromQuery(url.searchParams)),
    ),
    route(
      "POST",
      "/mock/fakers/:type",
      async ({ req, res, params, config }) => {
        const body = await readJsonBody(req, { maxBytes: config.maxBodyBytes });
        if (!body.ok)
          return body.aborted
            ? undefined
            : sendError(res, body.status, body.code, body.detail);
        return answer(res, params.type, body.value ?? {});
      },
    ),
  ];
}
