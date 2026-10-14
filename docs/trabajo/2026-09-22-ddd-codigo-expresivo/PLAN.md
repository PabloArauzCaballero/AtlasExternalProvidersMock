# Plan — DDD y código expresivo: Selección de escenario de proveedor emulado

- Fecha: 2026-09-22 · Repo: AtlasExternalProvidersMock (backend auxiliar) · Predecesor: ninguno en esta pasada
- Resultado observable de esta pasada: flujo, regla, evidencia y próxima comprobación definidos sin modificar producto.
- Kill-test: si no se puede seguir `src/server.mjs` → `src/scenarios.mjs`, el diagnóstico no está completo.

## Alcance

- IN: `src/server.mjs`, `src/scenarios.mjs`, `test/scenarios.test.mjs`, contrato y prueba de referencia del flujo.
- OUT: migraciones, cambios de API, UX o reglas no confirmadas; resto del repo.
- Ambigüedad registrada: No modelar respuestas del mock como política real de un proveedor.

## H1 — Diagnóstico y referencia

**CA:** Dado el flujo existente, cuando se inspeccionan entrada, decisión y resultado, entonces la regla tiene un propietario y una prueba de referencia identificables.
**DoD:** inspección de los archivos citados y `node --check src/scenarios.mjs` con el resultado literal del reporte.
**Estado:** HECHO

### H1.S1 — Rastrear y probar

**CA:** Dado el checkout actual, cuando se sigue el flujo, entonces se distingue regla de coordinación. **DoD:** rutas y símbolos reales registrados abajo. **Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD (comando de verificación) | Estado |
|---|---|---|---|---|
| H1.S1.M1 | Localizar entrada y propietario | Ambas rutas existen y se identificó la regla | `test -f 'src/server.mjs' && test -f 'src/scenarios.mjs'` → salida 0 | HECHO |
| H1.S1.M2 | Fijar referencia | El chequeo dirigido termina con salida 0 | `node --check src/scenarios.mjs` → Sintaxis válida; escenarios no probados | HECHO |

**Regla observada:** Un escenario explícito no recibe fallos aleatorios de demo.

## H2 — Próxima capacidad acotada

**CA:** Dado el contrato confirmado, cuando se ejerce la condición límite del flujo, entonces el resultado visible o persistido coincide con la regla y un rechazo no produce efecto parcial.
**DoD:** prueba de comportamiento dirigida, verificación de contrato y recorrido real si se modifica código; reporte con salida literal.
**Estado:** HECHO

### H2.S1 — Confirmar semántica antes de refactorizar

**CA:** La condición límite tiene resultado esperado documentado. **DoD:** prueba dirigida y revisión del contrato vigente. **Estado:** HECHO

| ID | Microtarea | CA (binario) | DoD (comando de verificación) | Estado |
|---|---|---|---|---|
| H2.S1.M1 | Probar que un escenario explícito no recibe fallo de fondo | Con error rate de 100 %, el escenario explícito no falla | `npm test` → salida 0 | HECHO |
| H2.S1.M2 | Probar latencia lenta | `slow_response` aplica el triple del techo del proveedor | mismo comando → salida 0 | HECHO |
| H2.S1.M3 | Probar un fallo de transporte | `provider_down` responde 503 con código estable | mismo comando → salida 0 | HECHO |

## Riesgos y bloqueos previstos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| No modelar respuestas del mock como política real de un proveedor. | Resultado o contrato falso | Confirmar con código, contrato y prueba antes de editar producto |

## Decisión de diseño

El propietario observado es `src/scenarios.mjs`. No se introduce una capa DDD nueva por nombre. Una refactorización futura necesitará mostrar una llamada más clara y la misma semántica en la entrada real, con prueba roja antes de cambiar implementación. Si la comprobación H2 demuestra que el diseño actual ya protege la regla, se registra como DESCARTADO el cambio de código.
