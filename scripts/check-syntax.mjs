import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function modulesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return modulesIn(path);
    return entry.isFile() && path.endsWith(".mjs") ? [path] : [];
  });
}

const modules = ["src", "scripts", "test"].flatMap(modulesIn);
for (const path of modules) {
  const result = spawnSync(process.execPath, ["--check", path], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Sintaxis válida en ${modules.length} módulos.`);
