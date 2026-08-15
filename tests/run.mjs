/**
 * tests/run.mjs
 * ---------------------------------------------------------------------------
 * Checks the parts of the module that can be reasoned about without Foundry:
 * matching compendium entries, spotting skipped advancement choices, reading
 * Plutonium's dialogs, and multiclass requirements.
 *
 * These are the rules that were worked out by inspecting real data, and each
 * one has a case here taken from that data - including the ones that caught me
 * out, like "Twilight Domain" matching "Light Domain" because one name contains
 * the other. Those are the cases worth keeping.
 *
 *   node tests/run.mjs
 *
 * No dependencies and no build step. Foundry's globals are stubbed just enough
 * for the modules to import; anything that genuinely needs a running game is
 * out of scope here and has to be checked in Foundry.
 */

// --- the smallest Foundry that lets the modules load ------------------------

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { confirm: async () => false }
    },
    instances: new Map(),
    ux: { TextEditor: { implementation: { enrichHTML: async (html) => html } } }
  }
};
globalThis.game = {
  packs: { get: () => null, filter: () => [] },
  settings: { get: () => null },
  user: { isGM: false },
  i18n: { localize: (key) => key }
};
globalThis.Hooks = { on: () => 0, off: () => {} };
globalThis.CONFIG = { DND5E: { abilities: {} } };
globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };

const { matchImporterEntry, groupByClass, normalise } = await import("../scripts/compendium.mjs");
const { choiceWasSkipped, itemsWithSkippedChoices, multiclassProblems } =
  await import("../scripts/validate.mjs");
const { DIALOGS, actorNameFromTitle } = await import("../scripts/option-watch.mjs");
const { planMigration, SCHEMA, SCHEMA_FLAG, MIGRATIONS } = await import("../scripts/migrate.mjs");
const { STEP_CONFIG } = await import("../scripts/sheet-actions.mjs");
const { hasPlaceholderName } = await import("../scripts/guide.mjs");
const { takeSnapshot, compareSnapshots } = await import("../scripts/snapshot.mjs");

// --- a tiny test harness ----------------------------------------------------

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}\n       expected ${b}\n       got      ${a}`);
    console.log(`  FAIL ${name}`);
  }
}

function group(title, body) {
  console.log(`\n${title}`);
  body();
}

// --- matching importer entries to the compendium ----------------------------

group("compendium: matching what the importer highlighted", () => {
  // Shaped like a real index read, including the two entries that share a
  // substring and the subclass that belongs to another class.
  const entries = [
    { uuid: "u1", name: "Sorcerer", type: "class", classId: "sorcerer", code: "XPHB" },
    { uuid: "u2", name: "Cleric", type: "class", classId: "cleric", code: "XPHB" },
    { uuid: "u3", name: "Clockwork Sorcery", type: "subclass", classId: "sorcerer", code: "XPHB" },
    { uuid: "u4", name: "Light Domain", type: "subclass", classId: "cleric", code: "XPHB" },
    { uuid: "u5", name: "Twilight Domain", type: "subclass", classId: "cleric", code: "TCE" },
    { uuid: "u6", name: "Life Domain", type: "subclass", classId: "cleric", code: "XPHB" }
  ];
  const name = (picked) => matchImporterEntry(entries, picked)?.name ?? null;

  check(
    "a subclass whose name contains another's is not confused with it",
    name({ name: "Twilight Domain", type: "subclass", parentName: "Cleric", code: "TCE" }),
    "Twilight Domain"
  );
  check(
    "plain hit",
    name({ name: "Light Domain", type: "subclass", parentName: "Cleric", code: "XPHB" }),
    "Light Domain"
  );
  check(
    "right name, wrong parent class, no match",
    name({ name: "Life Domain", type: "subclass", parentName: "Druid", code: "XPHB" }),
    null
  );
  check(
    "a class matches on its own name",
    name({ name: "Sorcerer", type: "class", parentName: "Sorcerer", code: "XPHB" }),
    "Sorcerer"
  );
  check(
    "absent from the compendium",
    name({ name: "Alchemist", type: "subclass", parentName: "Artificer", code: "EFA" }),
    null
  );
  check(
    "source code decides only between identical names",
    matchImporterEntry(
      [
        { uuid: "a", name: "Life Domain", type: "subclass", classId: "cleric", code: "XPHB" },
        { uuid: "b", name: "Life Domain", type: "subclass", classId: "cleric", code: "PHB" }
      ],
      { name: "Life Domain", type: "subclass", parentName: "Cleric", code: "PHB" }
    )?.uuid,
    "b"
  );

  const groups = groupByClass(entries);
  check("grouping keeps one heading per class", groups.map((g) => g.name), ["Cleric", "Sorcerer"]);
  check(
    "subclasses land under their own class",
    groups.find((g) => g.name === "Cleric").subclasses.map((s) => s.name),
    ["Life Domain", "Light Domain", "Twilight Domain"]
  );
  check("normalise strips punctuation and case", normalise("Path of the Berserker!"), "pathoftheberserker");
});

// --- skipped advancement choices --------------------------------------------

group("validate: advancement choices left unmade", () => {
  // Values copied from two characters that differed only in whether the player
  // worked through the choice dialogs.
  check("Size left blank", choiceWasSkipped({ type: "Size", value: { size: "" } }), true);
  check("Size filled in", choiceWasSkipped({ type: "Size", value: { size: "med" } }), false);
  check(
    "ability increase with nothing assigned",
    choiceWasSkipped({ type: "AbilityScoreImprovement", value: { type: "asi" } }),
    true
  );
  check(
    "ability increase assigned",
    choiceWasSkipped({
      type: "AbilityScoreImprovement",
      value: { type: "asi", assignments: { int: 2, wis: 1 } }
    }),
    false
  );
  check("trait with no choice made", choiceWasSkipped({ type: "Trait", value: { chosen: [] } }), true);
  check(
    "trait chosen",
    choiceWasSkipped({ type: "Trait", value: { chosen: ["skills:his"] } }),
    false
  );
  // The one that would fire on every correct character if the rule were just
  // "is it empty": ScaleValue holds figures derived from level, never choices.
  check("ScaleValue is empty on everyone and must be ignored",
    choiceWasSkipped({ type: "ScaleValue", value: {} }), false);
  check("HitPoints is not a choice we police",
    choiceWasSkipped({ type: "HitPoints", value: {} }), false);
  check("an unknown advancement type stays silent",
    choiceWasSkipped({ type: "SomethingNew", value: {} }), false);

  const actor = (advancement) => ({
    items: [{ id: "i1", name: "Acolyte", type: "background", system: { advancement } }]
  });
  check(
    "reported once per item, not once per entry",
    itemsWithSkippedChoices(
      actor([
        { type: "Trait", value: { chosen: [] } },
        { type: "Size", value: { size: "" } }
      ])
    ).map((p) => p.name),
    ["Acolyte"]
  );
  check(
    "a complete item is not reported",
    itemsWithSkippedChoices(actor([{ type: "Trait", value: { chosen: ["skills:rel"] } }])),
    []
  );
});

// --- multiclass requirements -------------------------------------------------

group("validate: multiclass requirements", () => {
  // primaryAbility exactly as it comes out of the compendium.
  const cls = (name, value, all) => ({
    type: "class",
    name,
    system: { primaryAbility: { value, all } }
  });
  const actor = (classes, abilities) => ({
    items: classes,
    system: { abilities: Object.fromEntries(Object.entries(abilities).map(([k, v]) => [k, { value: v }])) }
  });
  const names = (a) => multiclassProblems(a).map((p) => p.name);

  check(
    "one class, the rule does not apply",
    names(actor([cls("Wizard", ["int"], false)], { int: 8 })),
    []
  );
  check(
    "both requirements met",
    names(actor([cls("Wizard", ["int"], false), cls("Cleric", ["wis"], false)], { int: 15, wis: 13 })),
    []
  );
  check(
    "one short",
    names(actor([cls("Wizard", ["int"], false), cls("Cleric", ["wis"], false)], { int: 15, wis: 11 })),
    ["Cleric"]
  );
  check(
    "Paladin needs both of its abilities",
    names(actor([cls("Paladin", ["str", "cha"], true), cls("Bard", ["cha"], false)], { str: 15, cha: 12 })),
    ["Paladin", "Bard"]
  );
  check(
    "Fighter needs only one of its abilities",
    names(actor([cls("Fighter", ["str", "dex"], false), cls("Rogue", ["dex"], false)], { str: 8, dex: 16 })),
    []
  );
  check(
    "a class with no primary ability recorded is skipped, not assumed",
    names(actor([cls("Artificer", [], false), cls("Wizard", ["int"], false)], { int: 8 })),
    ["Wizard"]
  );
});

// --- Plutonium's dialogs -----------------------------------------------------

group("option-watch: reading Plutonium's dialogs", () => {
  /** Stands in for a dialog element. Only what the rules actually touch. */
  const dialog = ({ text = "", selects = [], heading = "" } = {}) => ({
    textContent: text,
    querySelectorAll: (sel) => (sel === "select" ? selects.map((value) => ({ value })) : []),
    querySelector: () => (heading ? { textContent: heading } : null)
  });
  const button = (text, primary = false) => ({
    textContent: text,
    classList: { contains: (c) => primary && c === "ve-btn-primary" }
  });

  /** What the watcher would conclude, without any of the actor plumbing. */
  const verdict = (title, app, btn) => {
    const rule = DIALOGS.find((d) => d.match(title, app));
    if (!rule) return "ignored";
    const { label } = rule.describe(title, app);
    if (!rule.confirms(btn, (btn.textContent ?? "").trim())) return `skipped:${label}`;
    const done = rule.complete(app);
    return done === true ? `done:${label}` : `partial:${label}`;
  };

  check(
    "Fighting Style skipped",
    verdict("Choose Option: Fighting Style (Level 1)", dialog(), button("Skip")),
    "skipped:Fighting Style"
  );
  check(
    "Fighting Style chosen",
    verdict("Choose Option: Fighting Style (Level 1)", dialog(), button("OK", true)),
    "done:Fighting Style"
  );
  check(
    "level is read out of the title",
    DIALOGS.find((d) => d.id === "choice").describe("Choose Option: Fighting Style (Level 1)", dialog()).level,
    1
  );
  check(
    "all cantrips learned",
    verdict("Select Cantrips", dialog({ text: "Cantrips learned: 3/3" }), button("OK", true)),
    "done:Select Cantrips"
  );
  check(
    "OK with fewer cantrips than were due",
    verdict("Select Cantrips", dialog({ text: "Cantrips learned: 2/3" }), button("OK", true)),
    "partial:Select Cantrips"
  );
  check(
    "cantrips skipped outright",
    verdict("Select Cantrips", dialog({ text: "Cantrips learned: 0/3" }), button("Skip")),
    "skipped:Select Cantrips"
  );
  check(
    "a choice cancelled counts the same as skipped",
    verdict("Choose Option: Fighting Style (Level 1)", dialog(), button("Cancel")),
    "skipped:Fighting Style"
  );
  check(
    "ability increase fully spent",
    verdict("Ability Score Improvement-Level 4", dialog({ text: "Remaining: 0" }), button("Confirm", true)),
    "done:Ability Score Improvement"
  );
  check(
    "ability increase with points left",
    verdict("Ability Score Improvement-Level 4", dialog({ text: "Remaining: 2" }), button("Confirm", true)),
    "partial:Ability Score Improvement"
  );
  check(
    "additional spells with the dropdown on its dash",
    verdict(
      "Additional Spells (Elf; Drow Lineage)",
      dialog({ text: "Innate/Prepared/Known Spells", selects: ["\u2014"] }),
      button("OK", true)
    ),
    "partial:Additional Spells (Elf; Drow Lineage)"
  );
  check(
    "additional spells filled in",
    verdict(
      "Additional Spells (Elf; Drow Lineage)",
      dialog({ text: "Dancing Lights", selects: ["cha"] }),
      button("OK", true)
    ),
    "done:Additional Spells (Elf; Drow Lineage)"
  );
  check(
    "a dialog with no title is named from its first heading",
    verdict(
      "",
      dialog({
        text: "Magic Initiate; Cleric Additional Spells (select a spell), (select a spell)",
        heading: "Magic Initiate; Cleric"
      }),
      button("OK", true)
    ),
    "partial:Magic Initiate; Cleric"
  );
  check(
    "an empty feat category",
    verdict("Feats", dialog({ text: "Select a Feat (Category: Dark Gift)", selects: ["\u2014"] }), button("OK", true)),
    "partial:Feats"
  );
  check(
    "a feat chosen",
    verdict("Feats", dialog({ text: "Select a Feat", selects: ["alert"] }), button("OK", true)),
    "done:Feats"
  );
  // The equipment dialog confirms with a button that is NOT primary. Treating
  // primary as the only confirmation everywhere would report it every time.
  check(
    "the equipment dialog is none of our business",
    verdict('Equipment-Fighter (Actor "X")', dialog(), button("Confirm")),
    "ignored"
  );
});

// --- telling one character's import from another's ---------------------------

group("option-watch: which character is being imported into", () => {
  // Two open panels mean two listeners on the document. Without this the same
  // verdict would be written onto both characters.
  check(
    "the wizard title names the character",
    actorNameFromTitle('Import Wizard: Importing to Actor "Barosław"'),
    "Barosław"
  );
  check(
    "curly quotes count too",
    actorNameFromTitle("Import Wizard: Importing to Actor \u201cTest okien\u201d"),
    "Test okien"
  );
  check("a dialog with no character named", actorNameFromTitle("Import Classes & Subclasses"), null);
  check("nothing at all", actorNameFromTitle(null), null);
});

// --- flag schema -------------------------------------------------------------

group("migrate: flag schema", () => {
  check(
    "an actor already at the current schema needs nothing",
    planMigration({ [SCHEMA_FLAG]: SCHEMA, abilities: {} }),
    null
  );
  check(
    "an actor with no schema is brought up to it",
    planMigration({ abilities: { str: 10 } })[SCHEMA_FLAG],
    SCHEMA
  );
  check(
    "there is a migration for every version below the current one",
    MIGRATIONS.length >= SCHEMA,
    true
  );
  // When nothing needed changing, only the schema number is written. Foundry
  // merges a flags update rather than replacing it, so untouched flags stay on
  // the actor precisely because they are absent here.
  check(
    "an unchanged migration writes the schema number and nothing else",
    Object.keys(planMigration({ languages: true, guideDismissed: true })),
    [SCHEMA_FLAG]
  );
  check("migrating twice is the same as migrating once",
    planMigration(planMigration({ abilities: {} })),
    null);
});

// --- step order --------------------------------------------------------------

group("steps: the order the panel presents them in", () => {
  // Class first, following D&D Beyond. The numbers in the panel are worked out
  // from position, so this list is the only place the order is stated - except
  // here, where it is stated again on purpose, so that reordering by accident
  // is caught.
  check("the item steps run class, species, background", Object.keys(STEP_CONFIG), [
    "class",
    "species",
    "background"
  ]);
});

// --- panel resilience --------------------------------------------------------

group("guide: a failure while preparing the panel", () => {
  // Not the real _prepareContext - that needs a running Foundry - but the shape
  // of the guard, which is what went wrong: it was narrow enough to miss a
  // throw two lines outside it, and the panel came up blank with no explanation.
  const prepare = (build) => {
    try {
      return build();
    } catch (err) {
      return { missing: false, panelFailed: true, actorName: "Test" };
    }
  };

  check("a working build passes through", prepare(() => ({ steps: [1, 2, 3] })).steps.length, 3);
  check(
    "a throw becomes a reportable state, not a blank window",
    prepare(() => {
      throw new ReferenceError("classes is not defined");
    }).panelFailed,
    true
  );
});

// --- the name step -----------------------------------------------------------

group("guide: when a character counts as named", () => {
  // The count on the sheet button was one short of the panel: a character
  // always has a name, so the step was treated as done from the start. But the
  // name we gave it is not a name anyone chose.
  check("the default name", hasPlaceholderName({ name: "New Character" }), true);
  check("the per-player default", hasPlaceholderName({ name: "New Character for Kamil" }), true);
  check("a chosen name", hasPlaceholderName({ name: "Barosław" }), false);
  check("a name that merely starts the same", hasPlaceholderName({ name: "New Characters Guild" }), false);
  check("an empty name is not a chosen one", hasPlaceholderName({ name: "  " }), true);
  check("no actor at all", hasPlaceholderName(null), true);
});

// --- what a level-up changed -------------------------------------------------

group("snapshot: reporting what actually changed", () => {
  const actor = ({ level = 1, hp = 12, items = [], classes = {}, slots = {}, skills = [], abilities = {}, saves = [], languages = [] }) => ({
    system: {
      details: { level },
      attributes: { hp: { max: hp } },
      spells: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { max: v }])),
      skills: Object.fromEntries(skills.map((k) => [k, { value: 1 }])),
      abilities: Object.fromEntries(
        Object.entries(abilities).map(([k, v]) => [k, { value: v, proficient: saves.includes(k) ? 1 : 0 }])
      ),
      traits: { languages: { value: languages } }
    },
    items: [
      ...items.map((n) => ({ type: n.startsWith("spell/") ? "spell" : "feat", name: n.replace("spell/", "") })),
      ...Object.entries(classes).map(([name, levels]) => ({ type: "class", name, system: { levels } }))
    ]
  });

  const labels = (before, after) =>
    compareSnapshots(takeSnapshot(before), takeSnapshot(after)).map((c) => `${c.kind}:${c.label}`);

  check(
    "a plain level: the class and the hit points",
    labels(
      actor({ hp: 12, classes: { Barbarian: 1 } }),
      actor({ hp: 19, classes: { Barbarian: 2 } })
    ),
    ["level:Barbarian", "hp:hp"]
  );
  check(
    "a level that grants a feature",
    labels(
      actor({ hp: 12, classes: { Barbarian: 1 }, items: ["Rage"] }),
      actor({ hp: 19, classes: { Barbarian: 2 }, items: ["Rage", "Reckless Attack"] })
    ),
    ["level:Barbarian", "hp:hp", "item:Reckless Attack"]
  );
  check(
    "taking a second class is reported as new, not as a level change",
    labels(
      actor({ classes: { Barbarian: 3 } }),
      actor({ classes: { Barbarian: 3, Cleric: 1 } })
    ),
    ["newClass:Cleric"]
  );
  check(
    "new spell slots",
    labels(
      actor({ classes: { Cleric: 1 }, slots: { spell1: 2 } }),
      actor({ classes: { Cleric: 2 }, slots: { spell1: 3 } })
    ),
    ["level:Cleric", "slots:spell1"]
  );
  check(
    "an ability increase",
    labels(
      actor({ classes: { Fighter: 3 }, abilities: { str: 15 } }),
      actor({ classes: { Fighter: 4 }, abilities: { str: 17 } })
    ),
    ["level:Fighter", "ability:str"]
  );
  check(
    "nothing changed, nothing reported",
    labels(actor({ classes: { Bard: 2 } }), actor({ classes: { Bard: 2 } })),
    []
  );
  // The case a set-difference would hide: a second copy of something already
  // held is still something gained.
  check(
    "a second copy of a feature already held",
    labels(
      actor({ classes: { Fighter: 1 }, items: ["Fighting Style"] }),
      actor({ classes: { Fighter: 1 }, items: ["Fighting Style", "Fighting Style"] })
    ),
    ["item:Fighting Style"]
  );
  check(
    "hit points going down are reported too",
    compareSnapshots(
      takeSnapshot(actor({ hp: 20, classes: { Bard: 3 } })),
      takeSnapshot(actor({ hp: 14, classes: { Bard: 2 } }))
    ).map((c) => c.detail),
    ["-6"]
  );
});

// --- result ------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`\n${failures.map((f) => `  ${f}`).join("\n\n")}`);
  process.exit(1);
}
