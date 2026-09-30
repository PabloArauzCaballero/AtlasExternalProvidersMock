/**
 * Escribe `build-info.json` con el commit compilado y el instante del build.
 *
 * Corre en la etapa `build-info` del Dockerfile.dev. El commit sale, por este orden, de:
 *   1. el argumento de build `SOURCE_COMMIT` si es un SHA de 40 hex;
 *   2. `.git` del checkout dentro del contexto de build.
 * Si ninguno da un SHA válido escribe `commit: null` y NO falla el build: la identidad no se inventa.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isCommitSha, readCommitFromGitDir } from "../src/build-identity.mjs";

const out = resolve(process.argv[2] ?? "build-info.json");
const fromArg = process.env.SOURCE_COMMIT?.trim();
const identity = {
  commit: isCommitSha(fromArg)
    ? fromArg
    : readCommitFromGitDir(resolve(".git")),
  builtAt: new Date().toISOString(),
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(identity, null, 2)}\n`);
console.log(
  `build-info: commit=${identity.commit ?? "NO DETERMINADO"} builtAt=${identity.builtAt} -> ${out}`,
);
