import { buildTestBankQr } from "../domain/test-qr.mjs";
import { identityOf, derivedReference, requestedAmount, requestedCurrency, requestedReference } from "../domain/derive.mjs";

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
/** `partial_match` es la "discrepancia" de la tabla del paquete QA; `data_not_available`, el pendiente. */
export const handledScenarios = ["happy_path", "expired_token", "partial_match", "data_not_available", "duplicate_request"];

export function respond(scenario, input = {}, operation = operationPath, ctx = {}) {
  if (operation.startsWith("/qr/generate")) {
    return { provider: code, ...buildTestBankQr({ ...input, scenario }) };
  }

  const identity = identityOf(input, ctx.personaKey);
  const amount = requestedAmount(input);
  const currency = requestedCurrency(input);
  const reference = requestedReference(input) ?? derivedReference("BANK-REF", identity, "transfer");
  const providerReference = derivedReference("BANK-MOCK", identity, `transfer|${reference}`);

  if (scenario === "expired_token") {
    return { provider: code, status: "TRANSFER_EXPIRED", amountMatches: null, referenceMatches: true, reference, currency, providerReference };
  }
  if (scenario === "partial_match") {
    // Discrepancia comprobable CONTRA lo pedido, no un número suelto: sin monto de entrada no hay
    // discrepancia que afirmar, y se dice con `null` en vez de inventarla.
    return {
      provider: code,
      status: "AMOUNT_MISMATCH",
      amountMatches: false,
      referenceMatches: true,
      requestedAmount: amount,
      receivedAmount: amount === null ? null : Number((amount * 0.85).toFixed(2)),
      currency,
      reference,
      manualReviewRequired: true,
      providerReference,
    };
  }
  if (scenario === "data_not_available") {
    ctx.setEntity?.({ phase: "PENDING", reference, amount, currency });
    return { provider: code, status: "PENDING", amountMatches: null, referenceMatches: null, reference, currency, providerReference };
  }
  if (scenario === "duplicate_request") {
    return {
      provider: code,
      status: "DUPLICATE_TRANSFER_REFERENCE",
      amountMatches: true,
      referenceMatches: true,
      duplicateDetected: true,
      firstSeenPhase: ctx.entity?.state?.phase ?? null,
      reference,
      currency,
      manualReviewRequired: true,
      providerReference,
    };
  }

  // `alreadyVerified` separa "se verificó ahora" de "ya estaba verificada", que es la diferencia
  // entre un reintento idempotente correcto y una transferencia contada dos veces.
  const alreadyVerified = ctx.entity?.state?.phase === "VERIFIED";
  ctx.setEntity?.({ phase: "VERIFIED", reference, amount, currency });
  return {
    provider: code,
    status: "VERIFIED",
    amountMatches: amount !== null,
    referenceMatches: true,
    requestedAmount: amount,
    receivedAmount: amount,
    currency,
    reference,
    alreadyVerified,
    providerReference,
  };
}
