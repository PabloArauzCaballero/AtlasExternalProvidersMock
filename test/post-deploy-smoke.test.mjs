import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { test } from "node:test";
import { startMock } from "./helpers.mjs";

const sha = "a".repeat(40);

async function probe(base, expectedSha) {
  const child = spawn(process.execPath, ["scripts/post-deploy-smoke.mjs"], {
    env: { ...process.env, SMOKE_BASE_URL: base, APP_COMMIT_SHA: expectedSha },
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const [status] = await once(child, "close");
  return { status, stderr };
}

test("healthcheck interno comprueba live, ready, catálogo y SHA", async () => {
  const mock = await startMock({ APP_COMMIT_SHA: sha });
  try {
    const version = await mock.call("/mock/version");
    assert.equal(version.body.commit, sha);
    const result = await probe(mock.base, sha);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    await mock.close();
  }
});

test("healthcheck falla ante un commit anterior", async () => {
  const mock = await startMock({ APP_COMMIT_SHA: "b".repeat(40) });
  try {
    const result = await probe(mock.base, sha);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SHA o versión/);
  } finally {
    await mock.close();
  }
});
