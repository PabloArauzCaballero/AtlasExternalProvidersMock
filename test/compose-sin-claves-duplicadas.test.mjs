import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Un compose con una clave repetida en el mismo nivel (p. ej. dos `environment:` en el servicio)
 * lo acepta YAML —gana la última— pero Coolify se queda con un servicio vacío: «no service
 * selected», retira el contenedor viejo y no levanta el nuevo. El 2026-09-26 dejó el mock de
 * TEST caído. Esta prueba lo detecta sin dependencias: claves por nivel de sangría.
 */
function clavesDuplicadas(texto) {
  const pila = [];
  const duplicadas = [];
  for (const linea of texto.split('\n')) {
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

for (const archivo of ['docker-compose.coolify.yml', 'docker-compose.dev.yml']) {
  test(`${archivo} no repite claves en un mismo nivel`, (t) => {
    let texto;
    try {
      texto = readFileSync(new URL(`../${archivo}`, import.meta.url), 'utf8');
    } catch {
      t.skip(`${archivo} no existe`);
      return;
    }
    assert.deepEqual(clavesDuplicadas(texto), []);
  });
}

test('el detector encuentra un environment repetido', () => {
  const texto = 'services:\n  mock:\n    environment:\n      A: 1\n    image: x\n    environment:\n      B: 2\n';
  assert.deepEqual(clavesDuplicadas(texto), ['environment']);
});
