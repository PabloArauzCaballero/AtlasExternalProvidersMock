# Atlas External Providers Mock Server

Servidor **independiente** (sin dependencias de `AtlasBackend` ni de `AtlasAdminPortal`,
sin build step) que emula los proveedores externos reales de ATLAS. Cada proveedor es un
módulo propio bajo `src/providers/`, con su propio health check, para poder migrarlo tal
cual a un repositorio/servicio externo en la siguiente fase.

## Levantar

```bash
npm start
# o, con reinicio automático al editar:
npm run dev
```

Por defecto escucha en `http://localhost:4010` — el mismo valor que
`EXTERNAL_PROVIDERS_MOCK_BASE_URL` espera en `AtlasBackend/.env` cuando un proveedor está
en modo `mock_server`.

## Desplegado en el VPS

La rama `dev` se despliega sola: cada push dispara `.github/workflows/deploy-dev.yml`, que entra
por Tailscale, le pide a Coolify que despliegue la aplicación `atlas-provider-mockup-server` y
**espera su veredicto** — si el build falla, el job termina en rojo. Es el mismo mecanismo de los
seis repositorios de Atlas.

Ahí NO se publica a internet: no lleva dominio. Quien lo consume es `AtlasBackend`, desde dentro
de la red compartida de Coolify, por el alias `external-providers-mock`. La URL que va en
`EXTERNAL_PROVIDERS_MOCK_BASE_URL` allá es, por tanto:

```
http://external-providers-mock:4010/mock
```

El `HEALTHCHECK` de la imagen ejecuta un smoke dentro del contenedor: consulta `/mock/live`,
`/mock/ready`, el catálogo de `/mock/health` y `/mock/version`, y compara el SHA servido con
`SOURCE_COMMIT` de Coolify. Tras `finished`, el workflow exige que Coolify informe
`running:healthy` para ese commit. Esta comprobación mantiene el servicio privado y falla si
el API token no puede leer el estado; no se ha probado aún contra una instalación real de Coolify.

**El sufijo `/mock` NO es opcional y es la trampa de este cableado.** El backend le concatena el
path del proveedor (`/segip`, `/infocenter`, …) en `mockBaseUrlFor()`. Sin el sufijo la llamada
sale a `http://external-providers-mock:4010/segip/identity/verify`, que aquí es un **404**
`{"status":"NOT_FOUND"}` — y el adaptador lo reporta como una falla del proveedor, no como una URL
mal armada. Este README decía la URL sin sufijo hasta el 8-sep-2026.

Para mirarlo desde el propio VPS, sin exponerlo:

```bash
docker run --rm --network coolify curlimages/curl -s http://external-providers-mock:4010/mock/health
```

## Pruebas

```bash
npm test       # contrato, aislamiento entre corridas y configuración (node:test, sin dependencias)
npm run smoke  # arranca el proceso de verdad y comprueba lo que el backend da por hecho
```

La suite existe desde el motor QA (21-sep-2026). Antes no había ninguna —y la documentación de
`AtlasBackend` citaba un `test/contract.test.mjs` que nunca existió—. Cada bloque nombra el falso
positivo que cierra: ruta inexistente que respondía 200, método equivocado que respondía 200,
escenario desconocido que caía al camino feliz. Los tres hacían pasar pruebas que no debían pasar.

## Health: vivo no es lo mismo que listo

| Ruta | Qué afirma |
| ---- | ---------- |
| `GET /mock/live` | El proceso atiende. Nada más. |
| `GET /mock/ready` | Además el catálogo está completo y coherente: ocho módulos, rutas bajo `/mock`, escenarios declarados. 503 con `problems[]` si no. |
| `GET /mock/health` | Compatibilidad: la forma que consume hoy `AtlasBackend`. |
| `GET /mock/health/<slug>` | Salud de un módulo. Un slug desconocido es 404 `UNKNOWN_MODULE`. |

Global (todos los módulos):

```bash
curl http://localhost:4010/mock/health
```

Por módulo/proveedor (uno por emulador):

```bash
curl http://localhost:4010/mock/health/segip
curl http://localhost:4010/mock/health/infocenter
curl http://localhost:4010/mock/health/qr
curl http://localhost:4010/mock/health/banking
curl http://localhost:4010/mock/health/telco
curl http://localhost:4010/mock/health/facebook
curl http://localhost:4010/mock/health/whatsapp
curl http://localhost:4010/mock/health/digital-trust
```

## Proveedores (emuladores) y su endpoint de negocio

| Proveedor real (código) | Módulo               | Endpoint                          |
| ------------------------ | -------------------- | ---------------------------------- |
| SEGIP / CGIP              | `providers/segip.mjs`         | `POST /mock/segip/identity/verify`        |
| INFOCENTER                | `providers/infocenter.mjs`    | `POST /mock/infocenter/credit-report`     |
| QR_GENERIC / QR_BCB_GENERIC | `providers/qr.mjs`           | `POST /mock/qr/payment/verify`            |
| BANKING_GENERIC           | `providers/banking.mjs`       | `POST /mock/banking/qr/generate` y `POST /mock/banking/transfer/verify` |
| TELCO_GENERIC             | `providers/telco.mjs`         | `POST /mock/telco/phone-trust/check`      |
| FACEBOOK_META             | `providers/facebook.mjs`      | `POST /mock/facebook/me`                  |
| WHATSAPP_GENERIC          | `providers/whatsapp.mjs`      | `POST /mock/whatsapp/verification/confirm`|
| DIGITAL_TRUST_GENERIC     | `providers/digital-trust.mjs` | `POST /mock/digital-trust/check`          |

Estos paths coinciden exactamente con lo que `AtlasBackend` arma vía
`mockBaseUrlFor()`/`callMockServer()` (`src/modules/external-data/application/external-data-policy.util.ts`
y `.../infrastructure/adapters/shared/mock-http.util.ts`) — no requieren ningún cambio en
el backend para funcionar cuando un proveedor está en modo `mock_server`.

## Catálogo

```bash
curl http://localhost:4010/mock/providers
```

Devuelve, por proveedor: `code`, `slug`, `domain`, `description`, `schemaVersion`, las `operations`
con su path completo y su método, el `latencyRangeMs`, los `handledScenarios` que ese módulo
distingue de verdad y la `scenarioMatrix` —las 18 filas con `supported: true|false` y el motivo—.
Lo consume el tablero de Proveedores externos del portal interno para explicar cada tarjeta y para
ofrecer sólo los escenarios que ese proveedor entiende: un desplegable de 18 opciones de las que la
mitad devuelve 422 es peor que no ofrecer ninguna.

## Latencia

Cada módulo declara su propio `latencyRangeMs`, porque un buró de crédito y un OAuth de Meta no
tardan lo mismo y un tablero de latencias con ocho valores idénticos no dice nada:

| Proveedor | Rango |
| --------- | ----- |
| INFOCENTER | 900–2500 ms |
| SEGIP | 600–1400 ms |
| BANKING_GENERIC | 400–1200 ms |
| DIGITAL_TRUST_GENERIC | 300–900 ms |
| TELCO_GENERIC | 300–800 ms |
| QR_GENERIC | 250–700 ms |
| WHATSAPP_GENERIC | 200–600 ms |
| FACEBOOK_META | 150–500 ms |

Manda por encima la cabecera `x-mock-latency-ms` cuando una prueba necesita un número exacto.
`MOCK_PROVIDERS_DEFAULT_LATENCY_MS` sigue sirviendo de red para un módulo que no declare rango.

`MOCK_PROVIDERS_ERROR_RATE` (0 por defecto, apagado) hace fallar una fracción de las llamadas con
un error de transporte realista. Es para las demos: un tablero de siete días al 100 % de éxito no
enseña nada. No toca las llamadas que piden un escenario explícito, que son pruebas.

## Escenarios

Se puede forzar un escenario por request con un header:

```bash
curl -X POST http://localhost:4010/mock/segip/identity/verify \
  -H "content-type: application/json" \
  -H "x-mock-scenario: partial_match" \
  -d '{"input": {}}'
```

O en el body:

```json
{ "scenario": "timeout", "input": {} }
```

O fijar un escenario por defecto para el tráfico **sin corrida declarada** (namespace legacy):

```bash
curl -X POST http://localhost:4010/mock/scenarios/active -d '{"scenario":"provider_down"}'
curl -X POST http://localhost:4010/mock/reset   # vuelve a happy_path
```

Ojo: desde 2.0 estas dos rutas **ya no son globales**. Tocan el namespace legacy y nada más. Antes
movían una variable de proceso, así que dos corridas en paralelo se pisaban el escenario y el
`reset` de una borraba el estado de la otra. Una corrida con namespace propio fija su escenario al
darse de alta y se resetea por su propia ruta.

### Un escenario que el proveedor no sabe representar es 422, no un camino feliz

```bash
curl -X POST http://localhost:4010/mock/segip/identity/verify -d '{"scenario":"cost_blocked"}'
# 422 SCENARIO_NOT_SUPPORTED_BY_PROVIDER + supportedScenarios[]
```

Y uno que no existe es 400 `UNKNOWN_SCENARIO`. Hasta 1.x las dos cosas devolvían **200 FOUND**: una
prueba que pedía `fraud_signal_high` a SEGIP obtenía una identidad verificada y se apuntaba un PASS.
`GET /mock/providers` publica la matriz proveedor × escenario con `supported` y motivo, para que el
portal ofrezca sólo lo que existe. `MOCK_PROVIDERS_STRICT_SCENARIOS=false` restaura el
comportamiento viejo si hace falta desbloquear a un consumidor; es un cambio de contrato
deliberado y con interruptor documentado, no un `if` escondido.

Escenarios soportados (`src/scenarios.mjs`):

`happy_path`, `provider_down`, `timeout`, `slow_response`, `invalid_payload`,
`unauthorized`, `rate_limited`, `not_found`, `partial_match`, `data_not_available`,
`manual_review_required`, `cost_blocked`, `duplicate_request`, `provider_internal_error`,
`fraud_signal_high`, `low_confidence`, `expired_token`, `revoked_consent`.

Los escenarios de transporte (`provider_down`, `unauthorized`, `rate_limited`,
`provider_internal_error`, `timeout`, `slow_response`, `invalid_payload`) aplican igual
sin importar el proveedor — viven en `scenarios.mjs`, no repetidos en cada módulo. Los
demás escenarios son de negocio y cada módulo de proveedor decide cómo responder.

## Corridas aisladas: el plano de control

Varias corridas de QA a la vez necesitan estado propio. Una corrida se da de alta por el plano de
control autenticado (`MOCK_PROVIDERS_CONTROL_TOKEN`, mínimo 16 caracteres; **sin él estas rutas
responden 503**, no quedan abiertas):

```bash
TOKEN=...   # MOCK_PROVIDERS_CONTROL_TOKEN
curl -X POST http://localhost:4010/mock/control/runs \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"tenantId":"t-1","runId":"run-42","seed":"s-1","scenarioProfile":"happy_path"}'
# 201 { ..., "runToken": "..." }   ← se entrega UNA vez y no vuelve a publicarse
```

El tráfico de negocio nombra la corrida por cabeceras y **tiene que traer su token**:

| Cabecera | Para qué |
| -------- | -------- |
| `x-mock-tenant-id`, `x-mock-run-id` | Qué corrida. Nombrarla sin el token es 401. |
| `x-mock-run-token` | Lo que impide que una cabecera pública elija namespace ajeno. |
| `x-mock-persona-key` | Aísla estado e idempotencia por persona. |
| `x-mock-logical-operation-id` | Identifica la operación para el plan de fallos y los reintentos. |
| `x-mock-attempt` | Intento declarado. Si falta, lo cuenta el emulador por operación. |
| `x-idempotency-key` | Misma clave + mismo cuerpo ⇒ se reproduce el resultado. Cuerpo distinto ⇒ 422. |
| `traceparent` | Sólo correlación (W3C). No identifica persona ni concede permisos. |

Rutas del plano de control (todas con `authorization: Bearer` y `x-mock-tenant-id`):

| Ruta | Qué hace |
| ---- | -------- |
| `POST /mock/control/runs` | Alta de corrida; devuelve `runToken`. |
| `GET /mock/control/runs` | Listado (sin tokens). |
| `GET,DELETE /mock/control/runs/:runId` | Detalle y baja. |
| `POST /mock/control/runs/:runId/reset` | Reset **con alcance**; `{"keepJournal":true}` conserva la evidencia. |
| `PUT,DELETE /mock/control/runs/:runId/fault-plan` | Plan de fallos, validado al plantarlo. |
| `PUT /mock/control/runs/:runId/fixtures` | Datos de persona de esa corrida. |
| `GET /mock/control/runs/:runId/journal?after=&limit=` | Evidencia con cursor: qué llegó, con qué escenario y por qué. |

El journal es lo que separa "el test pasó" de "la llamada salió por la red": un E2E que interceptó
`fetch` no deja rastro aquí. Guarda la **forma** del cuerpo y un `payloadHash`, nunca el contenido.

### Plan de fallos

```json
{
  "rules": [
    { "id": "segip-dos-primeros", "scenario": "provider_down",
      "match": { "provider": "segip", "personaKey": "p-7" },
      "applyTo": { "firstAttempts": 2 } }
  ]
}
```

Precedencia: regla del plan (la **más específica**, no la primera declarada) → escenario pedido en
la llamada → perfil de la corrida → default del servidor. Dos reglas con el mismo criterio son un
error de validación, no un desempate por orden: con orden, una regla amplia tapa a la fina en
silencio. El contador de intentos es **por operación lógica de esa persona**, nunca del proceso.

### Reinicio

El estado vive en memoria: reiniciar el emulador **pierde** los namespaces, y no se disimula. Cada
arranque tiene un `epoch`; una llamada que traiga `x-mock-epoch` de un arranque anterior recibe 409
`NAMESPACE_LOST_ON_RESTART` en vez de un namespace vacío que parecería sano. En el perfil `recovery`
esa distinción es justamente lo que se está probando.

## Agregar un proveedor nuevo

1. Crear `src/providers/<nombre>.mjs` exportando `code`, `slug`, `mountPath`,
   `operationPath` y `respond(scenario, input, operation, ctx)`.
2. Añadir los metadatos del catálogo: `domain`, `description`, `latencyRangeMs`, `operations` y
   `handledScenarios`. Son opcionales —el catálogo degrada con valores por defecto— pero sin
   ellos el proveedor sale sin explicación en el tablero del portal.
3. Registrarlo en `src/providers/index.mjs` (`providers` array).

El health check por módulo, el catálogo y **la tabla de rutas** salen automáticamente de esa lista.
El ruteo es por método y path exacto: lo que no esté en `operations` es 404, y el método equivocado
sobre una ruta que existe es 405 con `Allow`.

El tercer argumento de `respond` es la operación pedida relativa al `mountPath` (`/qr/generate`);
sólo lo necesita un proveedor con más de una operación, como `banking.mjs`. El cuarto es el
contexto de la corrida:

```js
respond(scenario, input, operation, { personaKey, attempt, entity, setEntity })
```

`entity` es el estado previo de esa persona para esa operación (o `null`) y `setEntity` lo
reemplaza. Vive en el namespace de la corrida, nunca en una variable del módulo: dos corridas en
paralelo no pueden compartirlo. Un proveedor sin estado ignora el cuarto argumento.

Las observaciones que el proveedor **inventa** (score, antigüedad, riesgo) se derivan con
`src/domain/derive.mjs` a partir de la identidad de la persona, en vez de ser constantes. Un
emulador que devuelve `bureauScore: 680` a todo el mundo convierte en tautología cualquier umbral
que el backend aplique encima.

## Cambios de contrato en 2.0 (21-sep-2026)

Los cinco son deliberados y cada uno cierra un falso positivo comprobado del paquete QA:

| Antes | Ahora | Hallazgo |
| ----- | ----- | -------- |
| Ruta inexistente bajo un `mountPath` ⇒ 200 | 404 `ROUTE_NOT_FOUND` | H04 |
| Método equivocado ⇒ 200 | 405 + `Allow` | H05 |
| Escenario desconocido o no soportado ⇒ 200 camino feliz | 400 / 422 con la lista | H06 |
| JSON roto ⇒ se trataba como cuerpo vacío | 400 `INVALID_JSON` | H07 |
| `activeScenario` y `reset` globales | Namespace por corrida; legacy aislado | H03 |

`MOCK_PROVIDERS_STRICT_SCENARIOS=false` revierte sólo el tercero. Los otros cuatro no tienen
interruptor: eran defectos, no configuración.

## Repositorio propio

Este emulador vivió como subcarpeta `mock-server/` dentro de `AtlasAdminPortal` hasta el
19-ago-2026. Se movió aquí porque nunca dependió de nada de aquel portal ni de
`AtlasBackend`, y porque el resto del ecosistema ya lo nombraba como repositorio
independiente: `AtlasBackend` lo cita por esta ruta en
`external-data-policy.util.ts` y `banking-qr.util.ts`, y el hub de documentación lo
declaraba en su lista de repositorios, donde aparecía como **no encontrado** en cada
importación.

La copia original sigue en `AtlasAdminPortal/mock-server` y no se ha tocado: retirarla es
un cambio de aquel repositorio, no de éste.

Para usarlo desde el backend, apuntar `EXTERNAL_PROVIDERS_MOCK_BASE_URL` a su URL **con el
sufijo `/mock`** (ver arriba por qué):

```bash
EXTERNAL_PROVIDERS_MOCK_BASE_URL=http://localhost:4010/mock
```
