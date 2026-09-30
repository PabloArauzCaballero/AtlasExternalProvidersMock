import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.mjs";
import {
  isCommitSha,
  loadBuildIdentity,
  parseBuildIdentity,
  readCommitFromGitDir,
  resolveCommit,
} from "../src/build-identity.mjs";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const BUILT_AT = "2026-09-30T01:02:03.000Z";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

describe("resolveCommit", () => {
  it("lo compilado manda sobre APP_COMMIT_SHA", () => {
    assert.equal(resolveCommit({ commit: SHA_A }, SHA_B), SHA_A);
  });

  it("OP-06: un APP_COMMIT_SHA vacío o contradictorio no suplanta lo compilado", () => {
    assert.equal(resolveCommit({ commit: SHA_A }, ""), SHA_A);
    assert.equal(resolveCommit({ commit: SHA_A }, "local"), SHA_A);
  });

  it("OP-01: sin dato compilado ni SHA válido devuelve unknown, nunca vacío", () => {
    for (const runtime of [undefined, "", "   ", "HEAD", "abc1234"]) {
      assert.equal(resolveCommit({ commit: null }, runtime), "unknown");
    }
  });

  it("sin dato compilado usa el runtime sólo si es un SHA completo", () => {
    assert.equal(resolveCommit({ commit: null }, SHA_B), SHA_B);
  });
});

describe("parseBuildIdentity / loadBuildIdentity", () => {
  it("descarta commit y fecha inválidos", () => {
    assert.deepEqual(
      parseBuildIdentity(
        JSON.stringify({ commit: "no-es-sha", builtAt: "ayer" }),
      ),
      { commit: null, builtAt: null },
    );
    assert.deepEqual(parseBuildIdentity("{roto"), {
      commit: null,
      builtAt: null,
    });
    assert.deepEqual(parseBuildIdentity("null"), {
      commit: null,
      builtAt: null,
    });
  });

  it("un archivo ausente da identidad vacía sin lanzar", () => {
    assert.deepEqual(
      loadBuildIdentity(join(tmpdir(), "no-existe", "build-info.json")),
      {
        commit: null,
        builtAt: null,
      },
    );
  });

  it("isCommitSha exige 40 hex en minúsculas", () => {
    assert.equal(isCommitSha(SHA_A), true);
    assert.equal(isCommitSha(SHA_A.toUpperCase()), false);
    assert.equal(isCommitSha(SHA_A.slice(1)), false);
    assert.equal(isCommitSha(undefined), false);
  });
});

describe("readCommitFromGitDir", () => {
  const gitDir = (head) => {
    const dir = tmp("gitdir-");
    mkdirSync(join(dir, "refs", "heads"), { recursive: true });
    writeFileSync(join(dir, "HEAD"), head);
    return dir;
  };

  it("HEAD desacoplado (así clona Coolify)", () => {
    assert.equal(readCommitFromGitDir(gitDir(`${SHA_A}\n`)), SHA_A);
  });

  it("HEAD que apunta a un ref suelto o a uno sólo empaquetado", () => {
    const suelto = gitDir("ref: refs/heads/dev\n");
    writeFileSync(join(suelto, "refs", "heads", "dev"), `${SHA_B}\n`);
    assert.equal(readCommitFromGitDir(suelto), SHA_B);
    const empaquetado = gitDir("ref: refs/heads/dev\n");
    writeFileSync(
      join(empaquetado, "packed-refs"),
      `# pack-refs\n${SHA_A} refs/heads/dev\n`,
    );
    assert.equal(readCommitFromGitDir(empaquetado), SHA_A);
  });

  it("sin .git o con ref irresoluble da null", () => {
    assert.equal(readCommitFromGitDir(join(tmpdir(), "nada")), null);
    assert.equal(
      readCommitFromGitDir(gitDir("ref: refs/heads/fantasma\n")),
      null,
    );
  });
});

describe("loadConfig con build-info", () => {
  it("el commit sellado gana al APP_COMMIT_SHA vacío que pasa el compose de TEST", () => {
    const dir = tmp("cfg-");
    writeFileSync(
      join(dir, "build-info.json"),
      JSON.stringify({ commit: SHA_A, builtAt: BUILT_AT }),
    );
    const config = loadConfig(
      { APP_COMMIT_SHA: "" },
      pathToFileURL(join(dir, "build-info.json")),
    );
    assert.equal(config.commit, SHA_A);
    assert.equal(config.builtAt, BUILT_AT);
  });

  it("sin build-info responde unknown y builtAt null", () => {
    const config = loadConfig(
      {},
      pathToFileURL(join(tmp("cfg-"), "no-hay.json")),
    );
    assert.equal(config.commit, "unknown");
    assert.equal(config.builtAt, null);
  });
});

describe("scripts/write-build-info.mjs (ejecutado de verdad)", () => {
  const script = join(root, "scripts", "write-build-info.mjs");
  const run = (cwd, env) => {
    // El script importa ../src/build-identity.mjs: se ejecuta desde el repo, con cwd = el checkout simulado.
    const out = join(cwd, "out", "build-info.json");
    execFileSync(process.execPath, [script, out], {
      cwd,
      env: { PATH: process.env.PATH ?? "", ...env },
      stdio: "pipe",
    });
    return JSON.parse(readFileSync(out, "utf8"));
  };

  it("toma SOURCE_COMMIT válido, sella builtAt y lo lee el lado de la app", () => {
    const cwd = tmp("wbi-");
    const info = run(cwd, { SOURCE_COMMIT: SHA_A });
    assert.equal(info.commit, SHA_A);
    assert.deepEqual(
      loadBuildIdentity(pathToFileURL(join(cwd, "out", "build-info.json"))),
      {
        commit: SHA_A,
        builtAt: info.builtAt,
      },
    );
  });

  it("SOURCE_COMMIT vacío cae a .git del checkout", () => {
    const cwd = tmp("wbi-");
    mkdirSync(join(cwd, ".git"));
    writeFileSync(join(cwd, ".git", "HEAD"), `${SHA_B}\n`);
    assert.equal(run(cwd, { SOURCE_COMMIT: "" }).commit, SHA_B);
  });

  it("SOURCE_COMMIT basura y sin .git deja null sin fallar el build", () => {
    assert.equal(run(tmp("wbi-"), { SOURCE_COMMIT: "HEAD" }).commit, null);
  });
});
