import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NO_REQUIRED_MARKER_NOTE,
  describeTemplate,
  missingRequiredMessage,
  parseTemplateFields,
} from "../src/tools/workflow.js";

/**
 * A 66-os sablon `startDetails` válaszának alakja: a `metadata` mezőkódokkal
 * kulcsolt objektum, a mezőkön **nincs** `required` (és `mandatory`) kulcs —
 * csak `visibility: MT_K` / `MT_M`, amiről a P0-6 nyitott kérdése szól: nem
 * tudjuk, hogy a `MT_K` kötelezőséget jelent-e.
 */
const TEMPLATE_66 = {
  success: true,
  result: {
    metadata: {
      partnerNev: { code: "partnerNev", name: "Partner neve", type: "Text", visibility: "MT_K" },
      nettoOsszeg: { code: "nettoOsszeg", name: "Nettó összeg", type: "Money", visibility: "MT_K" },
      fizetesiMod: {
        code: "fizetesiMod",
        name: "Fizetési mód",
        type: "Option",
        visibility: "MT_M",
        params: "|atutalas;keszpenz;kartya",
      },
    },
    allowedLinkedItemTypes: ["alszam", "foszam"],
  },
};

/** Ugyanaz a sablon, de a Flex jelöli a kötelezőséget (tömbös `metadata` alak). */
const TEMPLATE_WITH_FLAGS = {
  success: true,
  result: {
    metadata: [
      { code: "partnerNev", name: "Partner neve", type: "Text", required: false },
      { code: "nettoOsszeg", name: "Nettó összeg", type: "Money", required: true },
      {
        code: "fizetesiMod",
        label: "Fizetési mód",
        type: "Option",
        required: true,
        params: "|atutalas;keszpenz;kartya",
      },
    ],
    allowedLinkedItemTypes: [],
  },
};

describe("parseTemplateFields", () => {
  test("kötelezőség-jelölés nélküli sablonnál requiredMarkerPresent: false", () => {
    const parsed = parseTemplateFields(TEMPLATE_66);

    assert.equal(parsed.requiredMarkerPresent, false);
    assert.equal(parsed.fields.length, 3);
    assert.deepEqual(
      parsed.fields.map((field) => field.required),
      [false, false, false],
      "jelölés nélkül nem állítunk kötelezőséget",
    );
    assert.deepEqual(parsed.allowedLinkedItemTypes, ["alszam", "foszam"]);
    // A meglévő feldolgozás nem sérült: az Option értékei és a visibility megmarad.
    assert.deepEqual(parsed.fields[2].options, ["atutalas", "keszpenz", "kartya"]);
    assert.equal(parsed.fields[0].visibility, "MT_K");
  });

  test("required jelöléssel requiredMarkerPresent: true", () => {
    const parsed = parseTemplateFields(TEMPLATE_WITH_FLAGS);

    assert.equal(parsed.requiredMarkerPresent, true);
    assert.deepEqual(
      parsed.fields.filter((field) => field.required).map((field) => field.code),
      ["nettoOsszeg", "fizetesiMod"],
    );
  });

  test("a mandatory kulcs is kötelezőséget jelöl", () => {
    // A Flex melyik kulcsot használja, az a P0-6 nyitott kérdése — mindkettőt olvassuk.
    const parsed = parseTemplateFields({
      result: { metadata: [{ code: "OSSZEG", type: "Money", mandatory: true }] },
    });

    assert.equal(parsed.requiredMarkerPresent, true);
    assert.equal(parsed.fields[0].required, true);
  });

  test("a jelölés puszta jelenléte számít, az értéke nem", () => {
    // Csak required: false mezők → tudjuk, hogy semmi sem kötelező (nem azt, hogy nem tudjuk).
    const parsed = parseTemplateFields({
      result: { metadata: [{ code: "MEGJEGYZES", type: "Text", required: false }] },
    });

    assert.equal(parsed.requiredMarkerPresent, true);
    assert.equal(parsed.fields[0].required, false);
  });

  test("üres vagy hiányzó metadata nem borul fel", () => {
    for (const raw of [undefined, {}, { result: {} }, { result: { metadata: null } }]) {
      const parsed = parseTemplateFields(raw);
      assert.deepEqual(parsed.fields, []);
      assert.equal(parsed.requiredMarkerPresent, false);
    }
  });
});

describe("describeTemplate", () => {
  test('jelölés nélkül validation: "none" és magyarázó note', () => {
    const described = describeTemplate(66, TEMPLATE_66);

    assert.equal(described.validation, "none");
    assert.equal(described.note, NO_REQUIRED_MARKER_NOTE);
    assert.equal(described.templateId, 66);
    assert.equal(described.linkedItemRequired, true);
  });

  test("a nyers válasz alapból kimarad, includeRaw-val jön vissza", () => {
    const lean = describeTemplate(66, TEMPLATE_66);
    assert.ok(!("raw" in lean), "a raw megduplázná a payloadot, ezért alapból nincs benne");

    const verbose = describeTemplate(66, TEMPLATE_66, true);
    assert.equal(verbose.raw, TEMPLATE_66);
    // A többi mező mindkét módban ugyanaz — a raw csak hozzáadódik.
    assert.deepEqual(Object.keys(lean), Object.keys(verbose).filter((key) => key !== "raw"));
  });

  test('jelöléssel validation: "api-flag", note nélkül', () => {
    const described = describeTemplate(12, TEMPLATE_WITH_FLAGS);

    assert.equal(described.validation, "api-flag");
    assert.ok(!("note" in described), "ha az API jelöl, nem kell magyarázkodni");
    assert.equal(described.linkedItemRequired, false);
  });
});

describe("missingRequiredMessage", () => {
  test("jelölés nélküli sablonnál nem futtatunk ellenőrzést", () => {
    // Ez a P0-6 lényege: a régi kód itt „ellenőrizve" átengedett mindent, mert a
    // required mindig false volt — most nyíltan nem ellenőrzünk.
    const message = missingRequiredMessage(66, parseTemplateFields(TEMPLATE_66), {});
    assert.equal(message, undefined);
  });

  test("jelölt, de kitöltetlen mezőről hibaszöveg jön a kóddal és az opciókkal", () => {
    const message = missingRequiredMessage(12, parseTemplateFields(TEMPLATE_WITH_FLAGS), {
      nettoOsszeg: "400",
    });

    assert.ok(message, "kellene hibaszöveg");
    assert.ok(message.includes("- fizetesiMod [Option] (Fizetési mód)"));
    assert.ok(message.includes("lehetséges értékek: atutalas, keszpenz, kartya"));
    assert.ok(message.includes("a(z) 12 sablonhoz"));
    assert.ok(!message.includes("nettoOsszeg"), "a kitöltött mező nem hiányzik");
  });

  test("üres string, null és undefined is hiányzó értéknek számít", () => {
    const parsed = parseTemplateFields(TEMPLATE_WITH_FLAGS);
    for (const value of ["", null, undefined]) {
      const message = missingRequiredMessage(12, parsed, { nettoOsszeg: value, fizetesiMod: "kartya" });
      assert.ok(message?.includes("nettoOsszeg"), `${String(value)} esetén hiányzónak kell számítania`);
    }
  });

  test("minden jelölt mező kitöltve → nincs kifogás", () => {
    const message = missingRequiredMessage(12, parseTemplateFields(TEMPLATE_WITH_FLAGS), {
      nettoOsszeg: "400",
      fizetesiMod: "atutalas",
    });
    assert.equal(message, undefined);
  });
});
