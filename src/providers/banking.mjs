import { buildTestBankQr } from "../domain/test-qr.mjs";

export const code = "BANKING_GENERIC";
export const slug = "banking";
export const mountPath = "/mock/banking";
export const operationPath = "/transfer/verify";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Banca";
export const description = "Emisión de QR de cobro y confirmación de que una transferencia entró, con su monto y referencia.";
export const latencyRangeMs = [400, 1200];
/**
 * ÚNICO proveedor con dos operaciones, y el emulador tiene que distinguirlas: el backend llama a
 * `/qr/generate` para emitir el cobro y a `/transfer/verify` para confirmarlo. Antes las dos caían
 * en la misma respuesta, así que un QR llegaba con el payload de una verificación de transferencia
 * (`BANK-MOCK-OK`) y el adaptador rellenaba el QR con datos generados en proceso — funcionaba, pero
 * lo que se veía en pantalla no venía del emulador.
 */
export const operations = [
  { path: "/qr/generate", method: "POST", summary: "Emitir un QR de cobro de prueba" },
  { path: operationPath, method: "POST", summary: "Confirmar que una transferencia entró" },
];
export const handledScenarios = ["happy_path", "expired_token"];

export function respond(scenario, input = {}, operation = operationPath) {
  if (operation.startsWith("/qr/generate")) {
    return { provider: code, ...buildTestBankQr({ ...input, scenario }) };
  }
  if (scenario === "happy_path") {
    return {
      provider: code,
      status: "VERIFIED",
      amountMatches: true,
      referenceMatches: true,
      providerReference: "BANK-MOCK-OK",
    };
  }
  return {
    provider: code,
    status: "PENDING",
    amountMatches: null,
    referenceMatches: null,
    providerReference: "BANK-MOCK-001",
  };
}
