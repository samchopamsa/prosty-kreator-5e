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
globalThis.CONFIG = { DND5E: { abilities: {} }, Actor: { documentClass: { defaultName: () => "Player Character" } } };
globalThis.ui = { notifications: { warn: () => {}, info: () => {}, error: () => {} } };

const { matchImporterEntry, groupByClass, normalise } = await import("../scripts/compendium.mjs");
const { choiceWasSkipped, itemsWithSkippedChoices, multiclassProblems, checkCharacter } =
  await import("../scripts/validate.mjs");
const { DIALOGS, actorNameFromTitle } = await import("../scripts/option-watch.mjs");
const { planMigration, SCHEMA, SCHEMA_FLAG, MIGRATIONS } = await import("../scripts/migrate.mjs");
const { STEP_CONFIG } = await import("../scripts/sheet-actions.mjs");
const { hasPlaceholderName } = await import("../scripts/guide.mjs");
const { takeSnapshot, compareSnapshots } = await import("../scripts/snapshot.mjs");
const { uniqueActorName, tokenNameUpdate } = await import("../scripts/naming.mjs");
const { buildSteps } = await import("../scripts/steps.mjs");
const { selectClass, selectSubclass, featuresAtLevel, subclassFeaturesAtLevel, equipmentOptions, stripTags,
  featureHash, missingFeatures, countChoices, subclassIntro } =
  await import("../scripts/fivetools.mjs");

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
  // Multiclassing grants less than a first class does - no skill proficiencies
  // from the second - so those entries are empty by the rules, not by mistake.
  // Read as skipped, they produced a warning the player could not clear.
  // Taken from a real multiclassed Druid, whose Skills entry is {} and whose
  // Armor Training is {"chosen":[]} - both correct, because a second class
  // grants neither. classRestriction, which would have said so, is undefined on
  // every entry of a real character.
  check(
    "an empty trait on a second class is by the rules, not a skipped choice",
    choiceWasSkipped({ type: "Trait", value: {} }, true),
    false
  );
  check(
    "the same entry on a first class is still checked",
    choiceWasSkipped({ type: "Trait", value: { chosen: [] } }, false),
    true
  );
  // Size and ability increases are not granted by class at all, so an empty one
  // on a second class still means something went unanswered.
  check(
    "an ability increase is still checked on a second class",
    choiceWasSkipped({ type: "AbilityScoreImprovement", value: { type: "asi" } }, true),
    true
  );
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
  // Foundry's own default, and its copies. A character made with "Create Actor"
  // rather than through this module carries one of these, and the count on the
  // sheet button was a step short because of it.
  check("Foundry's default for the type", hasPlaceholderName({ name: "Player Character" }), true);
  check("a numbered copy of it", hasPlaceholderName({ name: "Player Character (2)" }), true);
  check("a numbered copy of ours", hasPlaceholderName({ name: "New Character (3)" }), true);
  check("a chosen name that ends in a number", hasPlaceholderName({ name: "Kaz (2)" }), false);
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

// --- waiting for the importer ------------------------------------------------

group("import-end: only signals raised after the wait began", () => {
  // The shape of the bug that made a three-level run stop after two: Foundry's
  // toast stays up for several seconds, so the second wait matched the FIRST
  // level's "Level up complete!" and returned before anything had happened.
  const accepts = (existing, present) => {
    const already = new Set(existing);
    return present.filter((n) => !already.has(n) && /level[- ]?up complete/i.test(n.text));
  };

  const first = { text: "Level up complete!" };
  const second = { text: "Level up complete!" };

  check("a fresh signal is accepted", accepts([], [first]).length, 1);
  check("a signal left over from the previous level is not", accepts([first], [first]).length, 0);
  check(
    "the next level's own signal still counts",
    accepts([first], [first, second]).length,
    1
  );
  check("an unrelated toast is ignored", accepts([], [{ text: "Rest complete" }]).length, 0);
});

// --- reading the rules from 5etools -----------------------------------------

group("fivetools: picking the right book", () => {
  // Both editions are in the data at once. Asking for "Fighter" without saying
  // which one is how you quietly get the 2014 class.
  const classes = [
    { name: "Fighter", source: "PHB", hd: { number: 1, faces: 10 } },
    { name: "Fighter", source: "XPHB", hd: { number: 1, faces: 10 } },
    { name: "Artificer", source: "EFA" },
    { name: "Mystic", source: "UATheMysticClass" }
  ];

  check("2024 wins by default", selectClass(classes, "Fighter")?.source, "XPHB");
  check("an explicit book is honoured", selectClass(classes, "Fighter", "PHB")?.source, "PHB");
  check("names are matched case-insensitively", selectClass(classes, "fighter")?.source, "XPHB");
  check("the Artificer is found in EFA", selectClass(classes, "Artificer")?.source, "EFA");
  // Unlisted books still beat returning nothing: homebrew arrives this way.
  check("an unranked source is still returned", selectClass(classes, "Mystic")?.source, "UATheMysticClass");
  check("an unknown class is null, not a guess", selectClass(classes, "Warlord"), null);
  check("insisting on a book it is not in gives null", selectClass(classes, "Artificer", "XPHB"), null);
});

group("fivetools: subclasses belong to a class, not a name", () => {
  const subclasses = [
    { name: "College of Swords", className: "Bard", classSource: "XPHB", source: "XPHB" },
    { name: "Path of the Berserker", className: "Barbarian", source: "XPHB" },
    // The case that matters: one subclass name under two different classes.
    { name: "Champion", className: "Fighter", source: "XPHB" },
    { name: "Champion", className: "Rogue", source: "HOMEBREW" }
  ];

  check(
    "the parent class decides which Champion",
    selectSubclass(subclasses, "Rogue", "Champion")?.source,
    "HOMEBREW"
  );
  check(
    "the Fighter's Champion is a different entry",
    selectSubclass(subclasses, "Fighter", "Champion")?.source,
    "XPHB"
  );
  check(
    "a subclass under the wrong class is not found",
    selectSubclass(subclasses, "Wizard", "College of Swords"),
    null
  );
});

group("fivetools: features come from the level field, not the array position", () => {
  // Shaped like the real reading: an array per level, each feature carrying its
  // own level. Here the two disagree, which is exactly what the field is for.
  const fighter = {
    name: "Fighter",
    classFeatures: [
      [
        { name: "Fighting Style", level: 1, source: "XPHB", entries: ["You have honed..."] },
        { name: "Second Wind", level: 1, source: "XPHB", entries: ["A limited well..."] },
        { name: "Weapon Mastery", level: 1, source: "XPHB", entries: ["Your training..."] }
      ],
      [{ name: "Action Surge", level: 2, source: "XPHB", entries: ["Push yourself..."] }],
      // Misfiled: sitting in the third group but marked as level 2.
      [{ name: "Tactical Mind", level: 2, source: "XPHB", entries: ["..."] }]
    ]
  };

  check(
    "level 1 gives all three",
    featuresAtLevel(fighter, 1).map((f) => f.name),
    ["Fighting Style", "Second Wind", "Weapon Mastery"]
  );
  check(
    "a misfiled feature is read from its own level",
    featuresAtLevel(fighter, 2).map((f) => f.name),
    ["Action Surge", "Tactical Mind"]
  );
  check("a level with nothing on it returns empty", featuresAtLevel(fighter, 4), []);
  check("a class with no features at all does not throw", featuresAtLevel({}, 1), []);
  check("a level given as a string still matches", featuresAtLevel(fighter, "1").length, 3);
});

group("fivetools: starting equipment", () => {
  // Taken verbatim from the Fighter reading, including the coin values, which
  // are in copper: 400 is the 4 GP the printed text quotes.
  const fighter = {
    startingEquipment: {
      defaultData: [
        {
          A: [
            { item: "chain mail|xphb" },
            { item: "greatsword|xphb" },
            { item: "javelin|xphb", quantity: 8 },
            { value: 400 }
          ],
          C: [{ value: 15500 }]
        }
      ]
    }
  };

  const options = equipmentOptions(fighter);
  check("each lettered choice becomes an option", options.map((o) => o.letter), ["A", "C"]);
  check("copper is reported as gold", options[0].gold, 4);
  check("the all-coin option reads as 155 GP", options[1].gold, 155);
  check(
    "the source suffix is not part of the name",
    options[0].items.map((i) => i.name),
    ["Chain Mail", "Greatsword", "Javelin"]
  );
  check("quantities survive", options[0].items[2].quantity, 8);
  check("a class without the field gives no options", equipmentOptions({}), []);
});

group("fivetools: stripping 5etools markup", () => {
  check(
    "a plain tag leaves its display text",
    stripTags("gain a {@feat Defense|XPHB} of your choice"),
    "gain a Defense of your choice"
  );
  check(
    "a third part overrides the first",
    stripTags("{@item Arrows (20)|XPHB|20 Arrows}"),
    "20 Arrows"
  );
  check("dice keep their formula", stripTags("regain {@dice 1d10} hit points"), "regain 1d10 hit points");
  // @filter's later parts are query syntax and would read as gibberish.
  check(
    "filter queries are not mistaken for text",
    stripTags("a {@filter Fighting Style feat|feats|category=FS}"),
    "a Fighting Style feat"
  );
  check("untagged text is left alone", stripTags("You can use this feature twice."), "You can use this feature twice.");
  check("nothing at all is empty, not a crash", stripTags(null), "");
});

group("fivetools: subclass features hide one level down", () => {
  // Taken from the Battle Master reading. Level 3 wraps its features in an
  // object named after the subclass; level 7's wrapper has no name at all.
  const battleMaster = {
    name: "Battle Master",
    className: "Fighter",
    subclassFeatures: [
      [
        {
          name: "Battle Master",
          level: 3,
          source: "XPHB",
          __prop: "subclassFeature",
          entries: [
            "{@i Master Sophisticated Battle Maneuvers}",
            "Battle Masters are students of the art of battle.",
            {
              name: "Combat Superiority",
              level: 3,
              source: "XPHB",
              __prop: "subclassFeature",
              entries: [
                "You learn maneuvers.",
                // No __prop: these are headings within the feature's own text.
                { type: "entries", name: "Maneuvers", entries: ["You learn three."] },
                { type: "entries", name: "Superiority Dice", entries: ["You have four."] }
              ]
            },
            {
              name: "Student of War",
              level: 3,
              source: "XPHB",
              __prop: "subclassFeature",
              entries: ["You gain proficiency with one type of tools."]
            },
            {
              name: "Maneuver Options",
              level: 3,
              source: "XPHB",
              __prop: "subclassFeature",
              entries: [
                "The maneuvers are presented in alphabetical order.",
                {
                  type: "options",
                  count: 3,
                  // A menu to pick from, not something the level grants.
                  entries: [
                    { name: "Ambush", __prop: "optionalfeature", entries: ["..."] },
                    { name: "Parry", __prop: "optionalfeature", entries: ["..."] }
                  ]
                }
              ]
            }
          ]
        }
      ],
      [
        {
          // The wrapper that caught this: level and header, but no name.
          className: "Fighter",
          level: 7,
          header: 2,
          __prop: "subclassFeature",
          entries: [
            {
              name: "Know Your Enemy",
              level: 7,
              source: "XPHB",
              __prop: "subclassFeature",
              entries: ["You can discern strengths and weaknesses."]
            }
          ]
        }
      ]
    ]
  };

  check(
    "the wrapper's own name is not reported as a gain",
    subclassFeaturesAtLevel(battleMaster, 3).map((f) => f.name),
    ["Combat Superiority", "Student of War", "Maneuver Options"]
  );
  check(
    "an unnamed wrapper yields the feature inside it",
    subclassFeaturesAtLevel(battleMaster, 7).map((f) => f.name),
    ["Know Your Enemy"]
  );
  check(
    "headings inside a feature stay part of its text",
    subclassFeaturesAtLevel(battleMaster, 3)[0].entries.length,
    3
  );
  // Maneuvers are chosen, not granted, so they must not be listed as gains.
  check(
    "optionalfeature entries are not mistaken for features",
    subclassFeaturesAtLevel(battleMaster, 3).some((f) => f.name === "Parry"),
    false
  );
  check("a level with nothing on it is empty", subclassFeaturesAtLevel(battleMaster, 5), []);
  check("a subclass with no features does not throw", subclassFeaturesAtLevel({}, 3), []);
});

group("fivetools: a subclass introduces itself inside its first level", () => {
  // The description of what a subclass is about has no entry of its own - it
  // sits in the wrapper for the level the subclass arrives at, ahead of the
  // features. Taken from the Battle Master reading.
  const battleMaster = {
    subclassFeatures: [
      [
        {
          name: "Battle Master",
          level: 3,
          __prop: "subclassFeature",
          entries: [
            "{@i Master Sophisticated Battle Maneuvers}",
            "Battle Masters are students of the art of battle.",
            { name: "Combat Superiority", level: 3, __prop: "subclassFeature", entries: ["..."] }
          ]
        }
      ],
      [
        {
          level: 7,
          __prop: "subclassFeature",
          entries: [{ name: "Know Your Enemy", level: 7, __prop: "subclassFeature", entries: ["..."] }]
        }
      ]
    ]
  };

  check("the introductory lines are recovered", subclassIntro(battleMaster).length, 2);
  check(
    "features are not mistaken for introduction",
    subclassIntro(battleMaster).some((line) => /Combat Superiority/.test(line)),
    false
  );
  // Later levels carry features, not introductions.
  check(
    "only the earliest level is read",
    subclassIntro(battleMaster)[0],
    "{@i Master Sophisticated Battle Maneuvers}"
  );
  check("a subclass with no features gives nothing", subclassIntro({}), []);
});

group("fivetools: the level that grants a subclass is marked", () => {
  // Fighter level 3 in the class data: the point where a subclass is chosen.
  const fighter = {
    classFeatures: [
      [{ name: "Second Wind", level: 1, entries: ["..."] }],
      [],
      [
        {
          name: "Fighter Subclass",
          level: 3,
          entries: ["You gain a Fighter subclass of your choice."],
          gainSubclassFeature: true
        }
      ]
    ]
  };

  check("the flag is carried through", featuresAtLevel(fighter, 3)[0].isGainSubclass, true);
  check("an ordinary feature is not flagged", featuresAtLevel(fighter, 1)[0].isGainSubclass, false);
});

group("fivetools: the hash that links a rule to a sheet item", () => {
  // Both strings below were read off a live character's flags.plutonium.hash.
  // They are the whole point of this function, so they are pinned exactly.
  const bardicInspiration = {
    name: "Bardic Inspiration",
    className: "Bard",
    classSource: "XPHB",
    level: 1,
    source: "XPHB",
    __prop: "classFeature"
  };
  const vitalityOfTheTree = {
    name: "Vitality of the Tree",
    className: "Barbarian",
    classSource: "XPHB",
    subclassShortName: "World Tree",
    subclassSource: "XPHB",
    level: 3,
    source: "XPHB",
    __prop: "subclassFeature"
  };

  check(
    "a class feature hashes as Plutonium stamped it",
    featureHash(bardicInspiration),
    "bardic%20inspiration_bard_xphb_1_xphb"
  );
  check(
    "a subclass feature carries the subclass shortName",
    featureHash(vitalityOfTheTree),
    "vitality%20of%20the%20tree_barbarian_xphb_world%20tree_xphb_3_xphb"
  );
  // A half-built hash would match the wrong thing, which is worse than no match.
  check(
    "a missing field gives null rather than a partial hash",
    featureHash({ name: "Rage", className: "Barbarian", __prop: "classFeature" }),
    null
  );
  check("nothing at all is null", featureHash(null), null);
});

group("fivetools: comparing the rules against the sheet", () => {
  const expected = [
    { name: "Rage", hash: "rage_barbarian_xphb_1_xphb" },
    { name: "Unarmored Defense", hash: "unarmored%20defense_barbarian_xphb_1_xphb" },
    { name: "Weapon Mastery", hash: "weapon%20mastery_barbarian_xphb_1_xphb" }
  ];

  const byHash = missingFeatures(expected, [
    { name: "Rage", hash: "rage_barbarian_xphb_1_xphb" },
    { name: "Unarmored Defense", hash: "unarmored%20defense_barbarian_xphb_1_xphb" }
  ]);
  check("what is absent is reported", byHash.missing.map((f) => f.name), ["Weapon Mastery"]);
  check("and how each match was made", byHash.matched.map((m) => m.by), ["hash", "hash"]);

  // The case that made this necessary: a character built from the system's own
  // compendium has features with no Plutonium flag, so no hash to match on.
  const byName = missingFeatures(expected, [
    { name: "Rage", hash: null },
    { name: "Unarmored Defense", hash: null },
    { name: "Weapon Mastery", hash: null }
  ]);
  check("unflagged features still match on their names", byName.missing, []);
  check("the weaker match is labelled as such", byName.matched.map((m) => m.by), ["name", "name", "name"]);

  check(
    "punctuation and case do not break a name match",
    missingFeatures([{ name: "Bardic Inspiration", hash: "x" }], [{ name: "bardic inspiration" }]).missing,
    []
  );
  check(
    "an empty sheet reports everything missing",
    missingFeatures(expected, []).missing.length,
    3
  );
  check("nothing expected is nothing missing", missingFeatures([], []).missing, []);
});

group("fivetools: choices are counted, not looked for", () => {
  // "Maneuver Options" is twenty maneuvers and an instruction to take three.
  // No character ever holds an item by that name, so expecting one would mean
  // reporting a permanent gap on every Battle Master.
  const maneuverOptions = {
    name: "Maneuver Options",
    level: 3,
    source: "XPHB",
    className: "Fighter",
    classSource: "XPHB",
    subclassShortName: "Battle Master",
    subclassSource: "XPHB",
    __prop: "subclassFeature",
    entries: [
      "The maneuvers are presented in alphabetical order.",
      {
        type: "options",
        count: 3,
        entries: [
          { name: "Ambush", __prop: "optionalfeature" },
          { name: "Brace", __prop: "optionalfeature" },
          { name: "Commanding Presence", __prop: "optionalfeature" },
          { name: "Parry", __prop: "optionalfeature" }
        ]
      }
    ]
  };

  const [expected] = subclassFeaturesAtLevel(
    { subclassFeatures: [[{ level: 3, __prop: "subclassFeature", entries: [maneuverOptions] }]] },
    3
  );

  check("the choice is recognised", expected.choice?.count, 3);
  check("with its options", expected.choice.options.length, 4);

  // Matched on the naming convention, not on the option list. The third
  // maneuver here is Brace, which is from TCE and so absent from the XPHB
  // "Maneuver Options" list - on a real character this reported 2 of 3.
  const full = countChoices([expected], [
    { name: "Maneuvers: Ambush" },
    { name: "Maneuvers: Brace" },
    { name: "Maneuvers: Commanding Presence" }
  ]);
  check("three of three is complete", full[0].isComplete, true);
  check("and an option from another book still counts", full[0].taken, 3);

  const short = countChoices([expected], [{ name: "Maneuvers: Ambush" }]);
  check("one of three is not", short[0].isComplete, false);
  check("the shortfall is visible", `${short[0].taken} of ${short[0].required}`, "1 of 3");

  // Divine Order is a choice whose result lands with page "classFeature"
  // rather than as an optional feature - the naming convention covers both.
  const divineOrder = {
    name: "Divine Order",
    choice: { count: 1, options: ["Protector", "Thaumaturge"] }
  };
  check(
    "a choice in the other namespace is counted too",
    countChoices([divineOrder], [
      { name: "Divine Order" },
      { name: "Divine Order: Protector" }
    ])[0].taken,
    1
  );
  check(
    "the feature itself is not mistaken for its own choice",
    countChoices([divineOrder], [{ name: "Divine Order" }])[0].taken,
    0
  );

  check(
    "a feature without a choice is not counted",
    countChoices([{ name: "Second Wind", choice: null }], []),
    []
  );
});

group("fivetools: features that never reach the sheet", () => {
  const asi = { name: "Ability Score Improvement", level: 4, entries: ["Increase one score..."] };
  const ordinary = { name: "Action Surge", level: 2, entries: ["Push yourself..."] };

  const fighter = { classFeatures: [[], [ordinary], [], [asi]] };

  check("ASI is flagged", featuresAtLevel(fighter, 4)[0].isPhantom, true);
  check("an ordinary feature is not", featuresAtLevel(fighter, 2)[0].isPhantom, false);
  // Every Fighter reaches level 4. Expecting an item by this name would mean
  // an unfixable warning on every character in the campaign.
  check(
    "an Epic Boon is the same case",
    featuresAtLevel({ classFeatures: [[{ name: "Epic Boon", level: 19 }]] }, 19)[0].isPhantom,
    true
  );
});

group("naming: a name nobody else is using", () => {
  const withActors = (names, fn) => {
    const before = globalThis.game;
    globalThis.game = { actors: { contents: names.map((name, i) => ({ name, id: `a${i}` })) } };
    try { return fn(); } finally { globalThis.game = before; }
  };

  check(
    "a free name is left alone",
    withActors(["Keray"], () => uniqueActorName("New Character")),
    "New Character"
  );
  check(
    "a taken name gets the next number",
    withActors(["New Character"], () => uniqueActorName("New Character")),
    "New Character (2)"
  );
  check(
    "and keeps counting past a gap-free run",
    withActors(["New Character", "New Character (2)"], () => uniqueActorName("New Character")),
    "New Character (3)"
  );
  // Otherwise a second copy of "(2)" becomes "New Character (2) (2)".
  check(
    "an existing number is part of the series, not the name",
    withActors(["New Character", "New Character (2)"], () => uniqueActorName("New Character (2)")),
    "New Character (3)"
  );
  check(
    "a character may keep its own name",
    withActors(["New Character"], () =>
      uniqueActorName("New Character", "a0")),
    "New Character"
  );
  check(
    "player names are numbered the same way",
    withActors(["New Character for Kamil"], () => uniqueActorName("New Character for Kamil")),
    "New Character for Kamil (2)"
  );
  check("an empty name still gives something", withActors([], () => uniqueActorName("")), "New Character");
});

group("naming: the token follows the character", () => {
  const placeholders = ["New Character", /^New Character for .+$/];

  // prototypeToken.name is copied once, at creation, and never again - so the
  // token kept saying "New Character" after the character became Łucznik.
  check(
    "a placeholder token name is replaced",
    tokenNameUpdate(
      { name: "New Character", prototypeToken: { name: "New Character" } },
      "Łucznik",
      placeholders
    ),
    { "prototypeToken.name": "Łucznik" }
  );
  check(
    "so is one matching the character's previous name",
    tokenNameUpdate({ name: "Keray", prototypeToken: { name: "Keray" } }, "Keray Two", placeholders),
    { "prototypeToken.name": "Keray Two" }
  );
  check(
    "an empty token name is filled in",
    tokenNameUpdate({ name: "Keray", prototypeToken: { name: "" } }, "Łucznik", placeholders),
    { "prototypeToken.name": "Łucznik" }
  );

  // The case worth protecting: a token deliberately named something else,
  // because the party does not know who the character is.
  check(
    "a deliberately different token name is left alone",
    tokenNameUpdate(
      { name: "Keray", prototypeToken: { name: "Hooded Stranger" } },
      "Łucznik",
      placeholders
    ),
    {}
  );
  check(
    "nothing to do when it already matches",
    tokenNameUpdate({ name: "Keray", prototypeToken: { name: "Łucznik" } }, "Łucznik", placeholders),
    {}
  );
});

group("steps: cleaning imported description text", () => {
  // Exercised through buildSteps, since the cleaner is internal. The actor is
  // the smallest thing steps.mjs will accept, with one background carrying a
  // description shaped like one from DDB Importer.
  const summaryOf = (html) => {
    const items = [
      {
        id: "bg",
        type: "background",
        name: "Criminal",
        img: "",
        system: { description: { value: html } },
        advancement: null,
        flags: {}
      }
    ];
    items.filter = Array.prototype.filter.bind(items);
    items.find = Array.prototype.find.bind(items);

    const actor = {
      name: "Test",
      img: "",
      items,
      system: { abilities: {}, traits: { languages: { value: [] } }, attributes: {}, spells: {} },
      getFlag: () => null,
      ownership: {}
    };
    // The text lives on the entry, not on the step: one step can hold
    // several items, as a multiclass character's class step does.
    return buildSteps(actor).find((step) => step.key === "background")?.entries?.[0]?.summary ?? "";
  };

  const ddb =
    "<p>Skill Proficiencies: &amp;Reference[slt]{Sleight of Hand} and " +
    "&amp;Reference[ste]{Stealth}. Tool Proficiency: Thieves' Tools. " +
    "Equipment: Choose A or B, then take two daggers and a crowbar with you.</p>";

  // The ampersand arrives encoded, so decoding after the strip left the markup
  // on screen with the ampersand restored.
  check("enricher markup does not survive", /Reference\[/.test(summaryOf(ddb)), false);
  // And what it would have displayed is the point of the sentence.
  check("its display text does", /Sleight of Hand/.test(summaryOf(ddb)), true);
  check("as does the second one", /Stealth/.test(summaryOf(ddb)), true);

  const rolls =
    "<p>You regain hit points equal to [[/r 1d10]] plus your level, and you may " +
    "consult @UUID[Compendium.dnd5e.x]{Second Wind} for the details of this feature.</p>";
  check("roll syntax is dropped", /\[\[/.test(summaryOf(rolls)), false);
  check("a UUID link keeps its label", /Second Wind/.test(summaryOf(rolls)), true);
});

group("validate: the heading counts what the list shows", () => {
  const actorWith = (abilities, flag = null) => {
    const items = [];
    items.filter = Array.prototype.filter.bind(items);
    items.find = Array.prototype.find.bind(items);
    return {
      name: "Test",
      type: "character",
      items,
      system: {
        abilities,
        attributes: { movement: { walk: 30 }, hp: { max: 10 } },
        details: {},
        traits: {}
      },
      getFlag: (mod, key) => (key === "abilities" ? flag : null)
    };
  };

  const tens = { str: { value: 10 }, dex: { value: 10 }, con: { value: 10 } };
  const assigned = { str: { value: 8 }, dex: { value: 16 }, con: { value: 14 } };

  const fromSheet = checkCharacter(actorWith(assigned));
  const abilityCheck = fromSheet.checks.find((c) => /abilit/i.test(c.label));
  // A character imported by another tool has no flag of ours and is still done.
  check("assigned scores pass without our flag", abilityCheck?.ok, true);

  const blank = checkCharacter(actorWith(tens));
  check("every score at ten does not", blank.checks.find((c) => /abilit/i.test(c.label))?.ok, false);

  // The deliberate case: all tens, but chosen through our own dialog.
  const deliberate = checkCharacter(actorWith(tens, { method: "standard" }));
  check(
    "unless they were chosen deliberately",
    deliberate.checks.find((c) => /abilit/i.test(c.label))?.ok,
    true
  );

  // The heading read "1 thing to fix" above six lines, because it counted
  // errors while the list showed warnings too.
  const failing = blank.checks.filter((c) => !c.ok).length;
  check("the total matches the failing checks", blank.problems, failing);
  check("and is at least as large as the errors alone", blank.problems >= blank.errors, true);
});

// --- result ------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`\n${failures.map((f) => `  ${f}`).join("\n\n")}`);
  process.exit(1);
}
