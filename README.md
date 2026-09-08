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

**El sufijo `/mock` NO es opcional y es la trampa de este cableado.** El backend le concatena el
path del proveedor (`/segip`, `/infocenter`, …) en `mockBaseUrlFor()`. Sin el sufijo la llamada
sale a `http://external-providers-mock:4010/segip/identity/verify`, que aquí es un **404**
`{"status":"NOT_FOUND"}` — y el adaptador lo reporta como una falla del proveedor, no como una URL
mal armada. Este README decía la URL sin sufijo hasta el 8-sep-2026.

Para mirarlo desde el propio VPS, sin exponerlo:

```bash
docker run --rm --network coolify curlimages/curl -s http://external-providers-mock:4010/mock/health
```

## Health

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

Devuelve, por proveedor: `code`, `slug`, `domain`, `description`, las `operations` con su path
completo, el `latencyRangeMs` y los `handledScenarios` que ese módulo distingue de verdad. Lo
consume el tablero de Proveedores externos del portal interno para explicar cada tarjeta y para
ofrecer sólo los escenarios que ese proveedor entiende.

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

O fijar un escenario activo por defecto para todos los módulos:

```bash
curl -X POST http://localhost:4010/mock/scenarios/active -d '{"scenario":"provider_down"}'
curl -X POST http://localhost:4010/mock/reset   # vuelve a happy_path
```

Escenarios soportados (`src/scenarios.mjs`):

`happy_path`, `provider_down`, `timeout`, `slow_response`, `invalid_payload`,
`unauthorized`, `rate_limited`, `not_found`, `partial_match`, `data_not_available`,
`manual_review_required`, `cost_blocked`, `duplicate_request`, `provider_internal_error`,
`fraud_signal_high`, `low_confidence`, `expired_token`, `revoked_consent`.

Los escenarios de transporte (`provider_down`, `unauthorized`, `rate_limited`,
`provider_internal_error`, `timeout`, `slow_response`, `invalid_payload`) aplican igual
sin importar el proveedor — viven en `scenarios.mjs`, no repetidos en cada módulo. Los
demás escenarios son de negocio y cada módulo de proveedor decide cómo responder.

## Agregar un proveedor nuevo

1. Crear `src/providers/<nombre>.mjs` exportando `code`, `slug`, `mountPath`,
   `operationPath` y `respond(scenario, input, operation)`.
2. Añadir los metadatos del catálogo: `domain`, `description`, `latencyRangeMs`, `operations` y
   `handledScenarios`. Son opcionales —el catálogo degrada con valores por defecto— pero sin
   ellos el proveedor sale sin explicación en el tablero del portal.
3. Registrarlo en `src/providers/index.mjs` (`providers` array).

El health check por módulo, el catálogo y el ruteo por `mountPath` salen automáticamente de esa
lista. El tercer argumento de `respond` es la operación pedida relativa al `mountPath`
(`/qr/generate`); sólo lo necesita un proveedor con más de una operación, como `banking.mjs`.

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
