/**
 * Espera cancelable, atada a la vida de la conexión.
 *
 * El emulador esperaba con `await new Promise((r) => setTimeout(r, latencyMs))`. Con el escenario
 * `timeout` eso son nueve segundos largos por llamada, y el temporizador seguía vivo aunque el
 * cliente ya hubiera cortado: bajo carga el proceso acumulaba miles de timers pendientes que sólo
 * servían para escribir sobre respuestas muertas. Peor: el escenario `timeout` existe precisamente
 * para que el consumidor aborte, o sea que el caso normal de ese escenario es el cliente cortando.
 *
 * `delay` resuelve `{ aborted: true }` en cuanto la respuesta se cierra, y limpia el temporizador y
 * el listener en ambas salidas.
 */
export function delay(ms, res) {
  if (!(ms > 0)) return Promise.resolve({ aborted: res.destroyed });
  return new Promise((resolve) => {
    let settled = false;
    const done = (aborted) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.removeListener("close", onClose);
      resolve({ aborted });
    };
    const onClose = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    res.once("close", onClose);
  });
}
