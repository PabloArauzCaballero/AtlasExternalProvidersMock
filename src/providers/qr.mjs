import { identityOf, derivedReference, requestedAmount, requestedCurrency, requestedReference } from "../domain/derive.mjs";

export const code = "QR_GENERIC";
export const slug = "qr";
export const mountPath = "/mock/qr";
export const operationPath = "/payment/verify";

/** Metadatos del catálogo (`GET /mock/providers`). No cambian la respuesta; explican al operador. */
export const domain = "Pagos";
export const description =
  "Verificación de pagos por QR interoperable: confirma monto, referencia y duplicados.";
export const latencyRangeMs = [250, 700];
export const operations = [{ path: operationPath, method: "POST", summary: "Verificar que un pago por QR entró" }];
/**
 * `data_not_available` = el pago todavía no llegó (PENDIENTE), que es el estado inicial real de una
 * verificación y no una respuesta de error. `expired_token` = la orden de cobro venció.
 */
export const handledScenarios = ["happy_path", "not_found", "partial_match", "duplicate_request", "data_not_available", "expired_token"];

/**
 * Verificación de un cobro por QR, COHERENTE con lo que se está cobrando.
 *
 * Antes el camino feliz devolvía siempre `paidAmount: 600`, `currency: "BOB"` y
 * `paidAt: "2026-01-01T12:00:00Z"` —hallazgo H09 del paquete QA—. Eso rompe en silencio la única
 * aserción que esta operación justifica: "lo pagado coincide con lo cobrado". Con una constante, el
 * test pasa aunque el motor le pase el cobro de otra persona, y sigue pasando si el backend deja de
 * comparar montos del todo.
 *
 * Ahora el monto, la moneda y la referencia salen del cuerpo de la petición; `partial_match`
 * devuelve un monto deliberadamente MENOR al pedido (una discrepancia comprobable, no un número
 * suelto) y el duplicado se detecta contra el estado de la corrida, no contra un escenario.
 */
export function respond(scenario, input = {}, _operation = operationPath, ctx = {}) {
  const identity = identityOf(input, ctx.personaKey);
  const amount = requestedAmount(input);
  const currency = requestedCurrency(input);
  const reference = requestedReference(input) ?? derivedReference("QR-REF", identity, "payment");
  const providerReference = derivedReference("QR-MOCK", identity, `payment|${reference}`);

  if (scenario === "not_found") {
    return { provider: code, status: "PAYMENT_NOT_FOUND", amountMatches: false, referenceMatches: false, reference, providerReference };
  }

  if (scenario === "data_not_available") {
    // El pago aún no entró. Se registra como PENDIENTE en el estado de la corrida para que una
    // verificación posterior pueda encontrarlo así en vez de partir de cero.
    ctx.setEntity?.({ phase: "PENDING", reference, amount, currency });
    return { provider: code, status: "PAYMENT_PENDING", amountMatches: null, referenceMatches: null, reference, currency, providerReference };
  }

  if (scenario === "expired_token") {
    return { provider: code, status: "PAYMENT_EXPIRED", amountMatches: null, referenceMatches: true, reference, currency, providerReference };
  }

  if (scenario === "partial_match") {
    // Discrepancia REAL contra lo pedido: 10 % menos. Sin monto pedido no hay discrepancia que
    // afirmar, y se dice así en vez de inventar una.
    const paidAmount = amount === null ? null : Number((amount * 0.9).toFixed(2));
    return {
      provider: code,
      status: "PAYMENT_PARTIAL_MATCH",
      amountMatches: false,
      referenceMatches: true,
      requestedAmount: amount,
      paidAmount,
      currency,
      reference,
      manualReviewRequired: true,
      providerReference,
    };
  }

  const previous = ctx.entity?.state ?? null;

  if (scenario === "duplicate_request") {
    return {
      provider: code,
      status: "DUPLICATE_PAYMENT_REFERENCE",
      amountMatches: true,
      referenceMatches: true,
      duplicateDetected: true,
      firstSeenPhase: previous?.phase ?? null,
      requestedAmount: amount,
      paidAmount: amount,
      currency,
      reference,
      manualReviewRequired: true,
      providerReference,
    };
  }

  // Camino feliz: el pago entró por el monto y la referencia que se estaban verificando.
  // `alreadyVerified` distingue "se verificó ahora" de "ya estaba verificado", que es la diferencia
  // entre un reintento idempotente correcto y un cobro contado dos veces.
  const alreadyVerified = previous?.phase === "VERIFIED";
  ctx.setEntity?.({ phase: "VERIFIED", reference, amount, currency });
  return {
    provider: code,
    status: "PAYMENT_VERIFIED",
    amountMatches: amount !== null,
    referenceMatches: true,
    requestedAmount: amount,
    paidAmount: amount,
    currency,
    reference,
    alreadyVerified,
    providerReference,
  };
}
