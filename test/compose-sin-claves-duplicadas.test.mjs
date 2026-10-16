import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Un compose con una clave repetida en el mismo nivel (p. ej. dos `environment:` en el servicio)
 * lo acepta YAML —gana la última— pero Coolify se queda con un servicio vacío: «no service
 * selected», retira el contenedor viejo y no levanta el nuevo. El 2026-09-26 dejó el mock de
 * TEST caído. Esta prueba lo detecta sin dependencias: claves por nivel de sangría.
 */
function clavesDuplicadas(texto) {
  const pila = [];
  const duplicadas = [];
  for (const linea of texto.split("\n")) {
    if (/^\s*(#|$)/.test(linea) || /^\s*-/.test(linea)) continue;
    const m = /^(\s*)([A-Za-z0-9_.-]+):(\s|$)/.exec(linea);
    if (!m) continue;
    const sangria = m[1].length;
    while (pila.length && pila[pila.length - 1].sangria > sangria) pila.pop();
    let nivel = pila[pila.length - 1];
    if (!nivel || nivel.sangria < sangria) {
      nivel = { sangria, claves: new Set() };
      pila.push(nivel);
    }
    if (nivel.claves.has(m[2])) duplicadas.push(m[2]);
    nivel.claves.add(m[2]);
  }
  return duplicadas;
}

// Los compose se descubren en la raíz en vez de listarse a mano: una lista fija nombraba un
// `docker-compose.dev.yml` que no existe y la prueba quedaba en SKIP, que en CI es un verde sin
// comprobar nada. El de Coolify es el que despliega TEST: si desaparece, es rojo, no skip.
const raiz = new URL("../", import.meta.url);
const composes = readdirSync(raiz).filter((f) =>
  /^docker-compose(\.[\w-]+)?\.ya?ml$/.test(f),
);

test("el compose de Coolify existe", () => {
  assert.ok(
    composes.includes("docker-compose.coolify.yml"),
    composes.join(", "),
  );
});

for (const archivo of composes) {
  test(`${archivo} no repite claves en un mismo nivel`, () => {
    const texto = readFileSync(new URL(archivo, raiz), "utf8");
    assert.deepEqual(clavesDuplicadas(texto), []);
  });
}

test("el detector encuentra un environment repetido", () => {
  const texto =
    "services:\n  mock:\n    environment:\n      A: 1\n    image: x\n    environment:\n      B: 2\n";
  assert.deepEqual(clavesDuplicadas(texto), ["environment"]);
});
