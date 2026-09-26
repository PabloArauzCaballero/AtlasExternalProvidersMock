import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInbox } from "../src/control/inbox.mjs";

describe("buzón QA", () => {
  it("guarda por destinatario normalizado y lee sólo lo posterior al cursor", () => {
    const inbox = createInbox();
    inbox.deliver("sms", { to: "+591 700-12345", body: "Tu código es 123456" });
    const second = inbox.deliver("email", { to: "Ana@Example.test", subject: "Código", body: "654321" });
    assert.equal(inbox.read({ to: "+59170012345", channel: "sms" }).messages[0].body, "Tu código es 123456");
    assert.equal(inbox.read({ to: "ana@example.test" }).messages[0].sequence, second);
    assert.equal(inbox.read({ to: "ana@example.test", after: second }).messages.length, 0);
  });

  it("toma el destino de deliveryTargets cuando no viene `to`", () => {
    const inbox = createInbox();
    inbox.deliver("whatsapp", { deliveryTargets: [{ address: "+59171112222" }], body: "999000" });
    assert.equal(inbox.read({ to: "+59171112222" }).messages.length, 1);
  });

  it("descarta lo más viejo que una hora", () => {
    let clock = 0;
    const inbox = createInbox({ now: () => clock });
    inbox.deliver("sms", { to: "1", body: "a" });
    clock = 61 * 60_000;
    assert.equal(inbox.read({ to: "1" }).messages.length, 0);
  });
});
