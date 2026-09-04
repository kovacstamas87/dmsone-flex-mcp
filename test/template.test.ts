import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  NO_REQUIRED_MARKER_NOTE,
  VISIBILITY_MARKER_NOTE,
  describeTemplate,
  missingRequiredMessage,
  parseTemplateFields,
  resolveOptionValues,
} from "../src/tools/workflow.js";

/**
 * A 66-os sablon `startDetails` válaszának alakja: a `metadata` mezőkódokkal
 * kulcsolt objektum, a mezőkön **nincs** `required` (és `mandatory`) kulcs —
 * csak `visibility: MT_K` / `MT_M`. A P0-6 lezárva (2026-09-03, élő
 * UI-egyeztetés a "Belső projekt jóváhagyás (v6)" sablonnal, 6/6 egyezés):
 * a `MT_K` kötelezőséget jelent, a `MT_M` nem.
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
  test("explicit jelölés nélküli, de visibility-t hordozó sablonnál a MT_K a kötelező", () => {
    const parsed = parseTemplateFields(TEMPLATE_66);

    assert.equal(parsed.requiredMarkerPresent, false);
    assert.equal(parsed.visibilityMarkerPresent, true);
    assert.equal(parsed.fields.length, 3);
    assert.deepEqual(
      parsed.fields.map((field) => field.required),
      [true, true, false],
      "MT_K → kötelező, MT_M → nem",
    );
    assert.deepEqual(parsed.allowedLinkedItemTypes, ["alszam", "foszam"]);
    // A meglévő feldolgozás nem sérült: az Option értékei és a visibility megmarad.
    // A kód a `params` lista 1-alapú sorszáma — ezt kell a start "metadata"-jában küldeni.
    assert.deepEqual(parsed.fields[2].options, [
      { code: "1", label: "atutalas" },
      { code: "2", label: "keszpenz" },
      { code: "3", label: "kartya" },
    ]);
    assert.equal(parsed.fields[0].visibility, "MT_K");
  });

  test("sem required/mandatory, sem visibility kulcs nélkül nem állítunk kötelezőséget", () => {
    const parsed = parseTemplateFields({
      result: { metadata: [{ code: "MEGJEGYZES", type: "Text" }] },
    });

    assert.equal(parsed.requiredMarkerPresent, false);
    assert.equal(parsed.visibilityMarkerPresent, false);
    assert.equal(parsed.fields[0].required, false);
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
  test('visibility-jelöléssel validation: "visibility-flag" és magyarázó note', () => {
    const described = describeTemplate(66, TEMPLATE_66);

    assert.equal(described.validation, "visibility-flag");
    assert.equal(described.note, VISIBILITY_MARKER_NOTE);
    assert.equal(described.templateId, 66);
    assert.equal(described.linkedItemRequired, true);
  });

  test('semmilyen jelölés nélkül validation: "none" és magyarázó note', () => {
    const described = describeTemplate(1, { result: { metadata: [{ code: "X", type: "Text" }] } });

    assert.equal(described.validation, "none");
    assert.equal(described.note, NO_REQUIRED_MARKER_NOTE);
  });

  test("a nyers válasz alapból kimarad, includeRaw-val jön vissza", () => {
    const lean = describeTemplate(66, TEMPLATE_66);
    assert.ok(!("raw" in lean), "a raw megduplázná a payloadot, ezért alapból nincs benne");

    const verbose = describeTemplate(66, TEMPLATE_66, true);
    assert.equal(verbose.raw, TEMPLATE_66);
    // A többi mező mindkét módban ugyanaz — a raw csak hozzáadódik.
    assert.deepEqual(
      Object.keys(lean),
      Object.keys(verbose).filter((key) => key !== "raw"),
    );
  });

  test('jelöléssel validation: "api-flag", note nélkül', () => {
    const described = describeTemplate(12, TEMPLATE_WITH_FLAGS);

    assert.equal(described.validation, "api-flag");
    assert.ok(!("note" in described), "ha az API jelöl, nem kell magyarázkodni");
    assert.equal(described.linkedItemRequired, false);
  });
});

describe("missingRequiredMessage", () => {
  test("semmilyen jelölés nélküli sablonnál nem futtatunk ellenőrzést", () => {
    const parsed = parseTemplateFields({ result: { metadata: [{ code: "X", type: "Text" }] } });
    const message = missingRequiredMessage(1, parsed, {});
    assert.equal(message, undefined);
  });

  test("visibility-jelöléssel a kitöltetlen MT_K mezőkről is jön hibaszöveg", () => {
    const message = missingRequiredMessage(66, parseTemplateFields(TEMPLATE_66), {});
    assert.ok(message, "kellene hibaszöveg — a P0-6 lezárása óta a MT_K is kötelezőnek számít");
    assert.ok(message.includes("partnerNev"));
    assert.ok(!message.includes("fizetesiMod"), "MT_M nem kötelező");
  });

  test("jelölt, de kitöltetlen mezőről hibaszöveg jön a kóddal és az opciókkal", () => {
    const message = missingRequiredMessage(12, parseTemplateFields(TEMPLATE_WITH_FLAGS), {
      nettoOsszeg: "400",
    });

    assert.ok(message, "kellene hibaszöveg");
    assert.ok(message.includes("- fizetesiMod [Option] (Fizetési mód)"));
    assert.ok(message.includes('lehetséges értékek: 1 = "atutalas"; 2 = "keszpenz"; 3 = "kartya"'));
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

/**
 * Option-mezők kód/címke feloldása. A Flex a kódot várja, a modell a címkét
 * látja — a tool mindkettőt elfogadja, és kódot küld.
 */
describe("resolveOptionValues", () => {
  const template = parseTemplateFields(TEMPLATE_WITH_FLAGS);

  test("a címke kódra fordul", () => {
    const resolved = resolveOptionValues(template, { fizetesiMod: "keszpenz", nettoOsszeg: "400" });
    assert.ok("metadata" in resolved);
    assert.equal(resolved.metadata.fizetesiMod, "2");
    assert.equal(resolved.metadata.nettoOsszeg, "400", "a nem-Option mezőt nem bántjuk");
  });

  test("a kód változatlanul megy tovább — a kód és a címke ugyanazt adja", () => {
    const byCode = resolveOptionValues(template, { fizetesiMod: "2" });
    const byLabel = resolveOptionValues(template, { fizetesiMod: "keszpenz" });
    assert.deepEqual(byCode, byLabel);
  });

  test("a címke illesztése kis/nagybetűre és térközre nem érzékeny", () => {
    const resolved = resolveOptionValues(template, { fizetesiMod: "  KARTYA " });
    assert.ok("metadata" in resolved);
    assert.equal(resolved.metadata.fizetesiMod, "3");
  });

  test("ismeretlen érték: hiba az érvényes lehetőségek listájával", () => {
    const resolved = resolveOptionValues(template, { fizetesiMod: "csekk" });
    assert.ok("error" in resolved);
    assert.ok(resolved.error.includes("fizetesiMod"));
    assert.ok(resolved.error.includes('1 = "atutalas"; 2 = "keszpenz"; 3 = "kartya"'));
  });

  test("számot ábrázoló címkénél a kód-értelmezés győz", () => {
    // A 66-os sablon `beruh` mezője valós példa: a címkék maguk is számok.
    const numeric = parseTemplateFields({
      result: {
        metadata: [{ code: "beruh", type: "Option", required: true, params: "|Nem beruházási;1;2;3;4" }],
      },
    });
    const resolved = resolveOptionValues(numeric, { beruh: "4" });
    assert.ok("metadata" in resolved);
    assert.equal(resolved.metadata.beruh, "4", 'a "4" a 4. lehetőség kódja, nem a "4" címkéé (az 5)');
  });

  test("üres és hiányzó érték érintetlen marad — arról a kötelezőség-ellenőrzés dönt", () => {
    const resolved = resolveOptionValues(template, { fizetesiMod: "" });
    assert.ok("metadata" in resolved);
    assert.equal(resolved.metadata.fizetesiMod, "");
  });
});
