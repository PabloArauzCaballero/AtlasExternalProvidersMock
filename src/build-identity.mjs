/**
 * Identidad del artefacto: commit e instante de build sellados en `build-info.json`.
 *
 * Lo escribe `scripts/write-build-info.mjs` UNA vez, en una etapa de build del Dockerfile, y viaja dentro
 * de la imagen. `APP_COMMIT_SHA` (variable de runtime) sólo rellena si el artefacto no trae commit y nunca
 * lo pisa: el compose de Coolify la define como `${SOURCE_COMMIT:-}` y el Coolify de TEST no rellena
 * `SOURCE_COMMIT`, así que llegaba vacía y `/mock/version` respondía `unknown`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const UNKNOWN_COMMIT = "unknown";
export const DEFAULT_BUILD_INFO_URL = new URL(
  "../build-info.json",
  import.meta.url,
);

export function isCommitSha(value) {
  return typeof value === "string" && COMMIT_SHA.test(value);
}

function isIsoInstant(value) {
  return (
    typeof value === "string" &&
    ISO_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function parseBuildIdentity(raw) {
  try {
    const parsed = JSON.parse(raw);
    const record = parsed && typeof parsed === "object" ? parsed : {};
    return {
      commit: isCommitSha(record.commit) ? record.commit : null,
      builtAt: isIsoInstant(record.builtAt) ? record.builtAt : null,
    };
  } catch {
    return { commit: null, builtAt: null };
  }
}

export function loadBuildIdentity(location = DEFAULT_BUILD_INFO_URL) {
  try {
    return parseBuildIdentity(readFileSync(location, "utf8"));
  } catch {
    return { commit: null, builtAt: null };
  }
}

/** Commit de un checkout leyendo `.git` sin el binario git (la imagen de build no lo trae). */
export function readCommitFromGitDir(gitDir) {
  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    if (isCommitSha(head)) return head;
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref) return null;
    try {
      const loose = readFileSync(join(gitDir, ref), "utf8").trim();
      if (isCommitSha(loose)) return loose;
    } catch {
      // el ref puede estar sólo en packed-refs
    }
    for (const line of readFileSync(join(gitDir, "packed-refs"), "utf8").split(
      "\n",
    )) {
      const [sha, name] = line.trim().split(" ");
      if (name === ref && isCommitSha(sha)) return sha;
    }
    return null;
  } catch {
    return null;
  }
}

/** Lo compilado manda; el runtime sólo rellena si es un SHA completo. Nunca cadena vacía. */
export function resolveCommit(compiled, runtimeCommit) {
  if (compiled.commit) return compiled.commit;
  const runtime = String(runtimeCommit ?? "").trim();
  return isCommitSha(runtime) ? runtime : UNKNOWN_COMMIT;
}
