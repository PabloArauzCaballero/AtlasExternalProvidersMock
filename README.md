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
| BANKING_GENERIC           | `providers/banking.mjs`       | `POST /mock/banking/transfer/verify`      |
| TELCO_GENERIC             | `providers/telco.mjs`         | `POST /mock/telco/phone-trust/check`      |
| FACEBOOK_META             | `providers/facebook.mjs`      | `POST /mock/facebook/me`                  |
| WHATSAPP_GENERIC          | `providers/whatsapp.mjs`      | `POST /mock/whatsapp/verification/confirm`|
| DIGITAL_TRUST_GENERIC     | `providers/digital-trust.mjs` | `POST /mock/digital-trust/check`          |

Estos paths coinciden exactamente con lo que `AtlasBackend` arma vía
`mockBaseUrlFor()`/`callMockServer()` (`src/modules/external-data/application/external-data-policy.util.ts`
y `.../infrastructure/adapters/shared/mock-http.util.ts`) — no requieren ningún cambio en
el backend para funcionar cuando un proveedor está en modo `mock_server`.

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
   `operationPath` y `respond(scenario, input)`.
2. Registrarlo en `src/providers/index.mjs` (`providers` array).

El health check por módulo y el ruteo por `mountPath` salen automáticamente de esa lista.

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

Para usarlo desde el backend, apuntar `EXTERNAL_PROVIDERS_MOCK_BASE_URL` a su URL:

```bash
EXTERNAL_PROVIDERS_MOCK_BASE_URL=http://localhost:4010
```
