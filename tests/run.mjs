/**
 * tests/run.mjs
 * ---------------------------------------------------------------------------
 * Checks the parts of the module that can be reasoned about without Foundry:
 * matching compendium entries, spotting skipped advancement choices, reading
 * the importer's dialogs, and multiclass requirements.
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

const { matchImporterEntry, groupByClass, normalise, sourceCode } =
  await import("../scripts/compendium.mjs");
const { choiceWasSkipped, itemsWithSkippedChoices, multiclassProblems, checkCharacter,
  abilitiesAssigned, isSecondaryClass } =
  await import("../scripts/validate.mjs");
const { DIALOGS, actorNameFromTitle } = await import("../scripts/option-watch.mjs");
const { planMigration, SCHEMA, SCHEMA_FLAG, MIGRATIONS } = await import("../scripts/migrate.mjs");
const { STEP_CONFIG } = await import("../scripts/sheet-actions.mjs");
const { hasPlaceholderName } = await import("../scripts/guide.mjs");
const { takeSnapshot, compareSnapshots } = await import("../scripts/snapshot.mjs");
const { readGains, diffGains, gainSections } = await import("../scripts/gains.mjs");
const { uniqueActorName, tokenNameUpdate } = await import("../scripts/naming.mjs");
const { buildSteps } = await import("../scripts/steps.mjs");
const { selectClass, selectSubclass, featuresAtLevel, subclassFeaturesAtLevel, equipmentOptions, stripTags,
  featureHash, missingFeatures, countChoices, subclassIntro } =
  await import("../scripts/rules-data.mjs");
const { STANDARD_ARRAY, POINT_BUY_TOTAL, newState, setMethod, stepAbility, baseValue,
  pointsSpent, isReady, existingBonus, buildRows, applyAbilities } =
  await import("../scripts/abilities-core.mjs");
const { flattenLanguages, keyForName, languageLabels, selectionFor, buildLanguageView,
  applyLanguages } =
  await import("../scripts/languages-core.mjs");

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

// Async bodies are awaited, so a group that writes to a stand-in actor can be
// checked here. A synchronous body runs to its end before this returns, so the
// groups that do not await keep their order.
async function group(title, body) {
  console.log(`\n${title}`);
  await body();
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
  // A Trait that actually asks something carries `choices`; one that only
  // hands out fixed proficiencies carries `grants` and asks nothing. Shapes
  // read from dnd5e 5.3.3's TraitConfigurationData.
  const asking = { choices: [{ count: 2, pool: ["skills:*"] }], grants: [] };
  const granting = { choices: [], grants: ["saves:dex", "saves:int"] };

  check(
    "trait with no choice made",
    choiceWasSkipped({ type: "Trait", configuration: asking, value: { chosen: [] } }),
    true
  );
  check(
    "trait chosen",
    choiceWasSkipped({ type: "Trait", configuration: asking, value: { chosen: ["skills:his"] } }),
    false
  );
  // THE FALSE ALARM. A class's saving throws and armour training are Traits
  // with grants filled and choices empty, so `chosen` can never be anything
  // else. Read as skipped, they accused the player of missing a question that
  // was never put to them - on a character where every dialog had been answered.
  check(
    "a trait that only grants is not a question anyone skipped",
    choiceWasSkipped({ type: "Trait", configuration: granting, value: { chosen: [] } }),
    false
  );
  // ItemChoice is keyed by level: an entry for level 3 is not outstanding on a
  // level 1 character, it simply has not come round yet.
  const atThree = { choices: { 3: { count: 1 } } };
  check(
    "an item choice from a level not yet reached is not outstanding",
    choiceWasSkipped({ type: "ItemChoice", configuration: atThree, value: {} }, false, 1),
    false
  );
  check(
    "the same choice once the level is reached",
    choiceWasSkipped({ type: "ItemChoice", configuration: atThree, value: {} }, false, 3),
    true
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
    choiceWasSkipped({ type: "Trait", configuration: asking, value: { chosen: [] } }, false),
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
        { type: "Trait", configuration: asking, value: { chosen: [] } },
        { type: "Size", value: { size: "" } }
      ])
    ).map((p) => p.name),
    ["Acolyte"]
  );
  check(
    "a complete item is not reported",
    itemsWithSkippedChoices(actor([{ type: "Trait", configuration: asking, value: { chosen: ["skills:rel"] } }])),
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

// --- the importer's dialogs -----------------------------------------------------

group("option-watch: reading the importer's dialogs", () => {
  /** Stands in for a dialog element. Only what the rules actually touch. */
  const dialog = ({ text = "", selects = [], heading = "", has = [] } = {}) => ({
    textContent: text,
    querySelectorAll: (sel) => (sel === "select" ? selects.map((value) => ({ value })) : []),
    // "has" pozwala udawac obecnosc konkretnego elementu w ciele okna - potrzebne
    // do przypadku, w ktorym cudzy pelny kreator niesie te sama klase CSS.
    querySelector: (sel) => (has.includes(sel) ? {} : heading ? { textContent: heading } : null)
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
  // --- starting equipment ---------------------------------------------------
  //
  // This dialog was deliberately ignored until we could read it, and the reason
  // is still true and still load-bearing: NOTHING in it carries ve-btn-primary.
  // Every other entry treats that class as "this is the confirm button"; here
  // that reading finds no confirmation at all, so every close would count as a
  // skip. The entry matches on the word "Confirm" instead, and this pair of
  // cases is what stops anyone reinstating the primary-only rule.
  check(
    "equipment confirmed, though its Confirm button is not primary",
    verdict('Equipment—Barbarian (Actor "New Character")', dialog(), button("Confirm")),
    "done:Starting Equipment: Barbarian"
  );
  check(
    "equipment skipped",
    verdict('Equipment—Barbarian (Actor "New Character")', dialog(), button("Skip")),
    "skipped:Starting Equipment: Barbarian"
  );
  // The class name is part of the label because a multiclass character meets
  // this window again, and two entries must not overwrite each other.
  check(
    "a second class gets its own entry",
    verdict('Equipment—Rogue (Actor "X")', dialog(), button("Skip")),
    "skipped:Starting Equipment: Rogue"
  );
  // Long dash in the real title, plain one in older builds - both read.
  check(
    "plain hyphen in the title reads the same",
    verdict('Equipment-Fighter (Actor "X")', dialog(), button("Confirm")),
    "done:Starting Equipment: Fighter"
  );
  // Okno pelnego kreatora postaci NIESIE TE SAMA KLASE co przyciski (A)/(B)
  // w oknie ekwipunku - sprawdzone w zywym swiecie. Dopasowanie po ciele okna
  // braloby wiec kazde przejscie zakladka za pominiety wybor i zapisywalo
  // ostrzezenie na postaci. Tytul jest jedynym bezpiecznym rozroznieniem.
  check(
    "pelny kreator postaci nie jest brany za okno ekwipunku",
    verdict(
      'Charactermancer (Actor "Player Character")',
      dialog({ has: [".imp-cls__disp-equi-choice-key"] }),
      button("Next")
    ),
    "ignored"
  );
  // "Remaining: 15" in this window is gold left unspent in the shop, NOT an
  // unfinished choice. Every other entry treats a "Remaining" counter as points
  // left to assign, so the temptation to reuse that rule here is real - and it
  // would warn about every character who kept a few coins.
  check(
    "unspent gold is not an unfinished choice",
    verdict(
      'Equipment—Barbarian (Actor "X")',
      dialog({ text: "Starting Equipment Shop Remaining: 15" }),
      button("Confirm")
    ),
    "done:Starting Equipment: Barbarian"
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

// --- reading the rules from the importer data -----------------------------------------

group("rules-data: picking the right book", () => {
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

group("rules-data: subclasses belong to a class, not a name", () => {
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

group("rules-data: features come from the level field, not the array position", () => {
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

group("rules-data: starting equipment", () => {
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

group("rules-data: stripping the importer's markup", () => {
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

group("rules-data: subclass features hide one level down", () => {
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

group("rules-data: a subclass introduces itself inside its first level", () => {
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

group("rules-data: the level that grants a subclass is marked", () => {
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

group("rules-data: the hash that links a rule to a sheet item", () => {
  // Both strings below were read off a live character's the importer's hash flag.
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
    "a class feature hashes as the importer stamped it",
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

group("rules-data: comparing the rules against the sheet", () => {
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
  // compendium has features with no importer flag, so no hash to match on.
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

group("rules-data: choices are counted, not looked for", () => {
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

group("rules-data: features that never reach the sheet", () => {
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

  const six = (...values) =>
    Object.fromEntries(
      ["str", "dex", "con", "int", "wis", "cha"].map((key, i) => [key, { value: values[i] }])
    );

  const tens = six(10, 10, 10, 10, 10, 10);
  const assigned = six(8, 16, 14, 12, 13, 15);
  // The case that made the earlier rule wrong: a blank sheet plus a
  // background's +2 and +1. Nobody chose anything, and three scores moved.
  const bonusesOnly = six(10, 12, 11, 10, 10, 10);

  const fromSheet = checkCharacter(actorWith(assigned));
  const abilityCheck = fromSheet.checks.find((c) => /abilit/i.test(c.label));
  // A character imported by another tool has no flag of ours and is still done.
  check("assigned scores pass without our flag", abilityCheck?.ok, true);

  const blank = checkCharacter(actorWith(tens));
  check("every score at ten does not", blank.checks.find((c) => /abilit/i.test(c.label))?.ok, false);

  // Three scores away from ten is exactly what bonuses alone produce, so it
  // cannot count as assignment - the step read "done" on 10/12/11/10/10/10.
  const bonused = checkCharacter(actorWith(bonusesOnly));
  check(
    "species and background bonuses alone do not count",
    bonused.checks.find((c) => /abilit/i.test(c.label))?.ok,
    false
  );

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

group("validate: telling assigned scores from bonuses", () => {
  const six = (...values) => ({
    system: {
      abilities: Object.fromEntries(
        ["str", "dex", "con", "int", "wis", "cha"].map((key, i) => [key, { value: values[i] }])
      )
    }
  });

  check("a blank sheet is not assigned", abilitiesAssigned(six(10, 10, 10, 10, 10, 10)), false);
  // 2024 backgrounds give +2/+1 or +1/+1/+1 - never more than three abilities.
  check("one bonus is not", abilitiesAssigned(six(12, 10, 10, 10, 10, 10)), false);
  check("two are not", abilitiesAssigned(six(12, 11, 10, 10, 10, 10)), false);
  check("three are not - that is the most a bonus can move", abilitiesAssigned(six(12, 11, 11, 10, 10, 10)), false);
  // Four is more than any bonus explains.
  check("four are", abilitiesAssigned(six(12, 11, 11, 9, 10, 10)), true);
  check("the standard array is", abilitiesAssigned(six(15, 14, 13, 12, 10, 8)), true);
  check("a rolled character is", abilitiesAssigned(six(9, 16, 14, 11, 13, 7)), true);
  check("an empty sheet does not throw", abilitiesAssigned({}), false);
});

// --- telling a multiclass from a first class ---------------------------------

group("validate: which class was taken first", () => {
  const classItem = (id, { identifier = id, primary = undefined } = {}) => ({
    id,
    type: "class",
    system: { identifier },
    flags: primary === undefined ? {} : { plutonium: { isPrimaryClass: primary } }
  });

  const actorWith = (items, originalClass = "") => ({
    items,
    system: { details: { originalClass } }
  });

  // The importer's own answer, which needs nothing else.
  const fighter = classItem("aaa", { primary: true });
  const wizard = classItem("bbb", { primary: false });
  const flagged = actorWith([fighter, wizard]);
  check("the importer's flag says the first class is first", isSecondaryClass(flagged, fighter), false);
  check("...and the second is second", isSecondaryClass(flagged, wizard), true);

  // A compendium class carries no flag at all. This is the case that produced
  // a warning nothing could clear.
  const rogue = classItem("ccc");
  const cleric = classItem("ddd");
  const byId = actorWith([rogue, cleric], "ccc");
  check("dnd5e's own record names the first class", isSecondaryClass(byId, rogue), false);
  check("...so the other one is the multiclass", isSecondaryClass(byId, cleric), true);

  // Some data stores the identifier rather than the id; both are accepted, so
  // the same pair is asked again with originalClass holding "rogue".
  const named = classItem("eee", { identifier: "rogue" });
  const byIdentifier = actorWith([named, cleric], "rogue");
  check("the identifier is accepted where the id would be", isSecondaryClass(byIdentifier, named), false);
  check("...and the other class is still the multiclass", isSecondaryClass(byIdentifier, cleric), true);

  // One class is the first one whatever else is recorded - checked before
  // originalClass, which on a single-class character is routinely empty.
  const alone = classItem("fff");
  check("a lone class is never a multiclass", isSecondaryClass(actorWith([alone]), alone), false);
  check(
    "...even with nothing recorded at all",
    isSecondaryClass({ items: [alone], system: {} }, alone),
    false
  );

  // Two classes and no record of which came first. Suppressing the check on
  // both is the deliberate choice: a missed warning beats one that cannot be
  // cleared.
  const nothingRecorded = actorWith([rogue, cleric], "");
  check("two classes and no record reads as multiclass", isSecondaryClass(nothingRecorded, rogue), true);

  check("a background is not a class", isSecondaryClass(byId, { type: "background", id: "ccc" }), false);
  check("nothing at all does not throw", isSecondaryClass(null, null), false);
});

// --- book codes for entries the importer never touched -----------------------

group("compendium: working out a book code without the importer's flag", () => {
  // The flag wins outright - it is already the code we compare against.
  check(
    "the importer's flag is used as-is",
    sourceCode({ flags: { plutonium: { source: "XPHB" } }, system: { source: { book: "PHB 2024" } } }),
    "XPHB"
  );

  // dnd5e records the edition separately; the label alone also carries it.
  check(
    "rules 2024 promotes the Player's Handbook",
    sourceCode({ system: { source: { book: "Player's Handbook", rules: "2024" } } }),
    "XPHB"
  );
  check(
    "so does a label saying 2024",
    sourceCode({ system: { source: { book: "PHB 2024" } } }),
    "XPHB"
  );
  check(
    "the 2014 book keeps the plain code",
    sourceCode({ system: { source: { book: "Player's Handbook", rules: "2014" } } }),
    "PHB"
  );
  check("an abbreviation is recognised too", sourceCode({ system: { source: { book: "TCoE" } } }), "TCE");

  // The SRD's version number moves between releases; the book does not.
  check("SRD 5.2", sourceCode({ system: { source: { book: "SRD 5.2" } } }), "SRD");
  check("SRD 5.1", sourceCode({ system: { source: { book: "SRD 5.1" } } }), "SRD");

  // An unrecognised book scores nothing rather than a guess, which leaves the
  // match exactly where it was before any of this: first candidate wins.
  check("homebrew is not guessed at", sourceCode({ system: { source: { book: "Northlands" } } }), "");
  check("no source at all", sourceCode({}), "");
  check("an empty label", sourceCode({ system: { source: { book: "" } } }), "");
});

group("gains: what a step put on the sheet", () => {
  // A sheet as gains.mjs reads it. Only the fields a step can change, in the
  // shapes dnd5e actually keeps them in - languages as a Set, because reading
  // that one as an object is the mistake this module has made before.
  const sheet = ({
    items = [],
    skills = [],
    saves = [],
    tools = [],
    languages = [],
    abilities = {},
    currency = {},
    hp = 0,
    speed = 30,
    size = "med"
  }) => ({
    items: items.map(([type, name]) => ({ type, name, img: `${name}.webp`, flags: {} })),
    system: {
      skills: Object.fromEntries(skills.map((k) => [k, { value: 1 }])),
      tools: Object.fromEntries(tools.map((k) => [k, { value: 1 }])),
      abilities: Object.fromEntries(
        Object.entries({ str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...abilities }).map(
          ([k, v]) => [k, { value: v, proficient: saves.includes(k) ? 1 : 0 }]
        )
      ),
      traits: { languages: { value: new Set(languages) }, weaponProf: { value: [] }, size },
      attributes: { hp: { max: hp }, movement: { walk: speed } },
      currency
    }
  });

  const read = (spec) => readGains(sheet(spec));
  const diff = (before, after) => diffGains(read(before), read(after));

  const empty = { hp: 0 };
  const cleric = {
    items: [["class", "Cleric"], ["subclass", "Life Domain"], ["feat", "Spellcasting"],
            ["spell", "Guidance"], ["equipment", "Chain Mail"], ["weapon", "Mace"]],
    skills: ["prc", "rel"],
    saves: ["wis", "cha"],
    languages: ["celestial"],
    hp: 10,
    currency: { gp: 15 }
  };

  const record = diff(empty, cleric);

  check("hit points are a gain, not a total", record.hp, 10);
  check("skills the step added", record.skills, ["prc", "rel"]);
  check("saving throws the step added", record.saves, ["wis", "cha"]);
  check("coins are counted as a gain", record.currency, { gp: 15 });
  check("every item that arrived", record.items.map((i) => i.name),
    ["Cleric", "Life Domain", "Spellcasting", "Guidance", "Chain Mail", "Mace"]);

  // The whole reason this is a diff and not a reading: what was already there
  // belongs to whatever put it there, not to this step.
  const second = diff(cleric, {
    ...cleric,
    items: [...cleric.items, ["feat", "Channel Divinity"]],
    skills: ["prc", "rel", "ins"],
    hp: 18
  });
  check("only the new skill", second.skills, ["ins"]);
  check("only the new item", second.items.map((i) => i.name), ["Channel Divinity"]);
  check("hit points as the difference", second.hp, 8);

  check("nothing changed is no record at all", diff(cleric, cleric), null);

  // A step that only took something away has nothing to show. Reporting -8 hit
  // points under "what this step added" would read as a bug.
  check("losses are not gains", diff(cleric, empty), null);

  // Two identical potions are two gains; matching by value alone hides one.
  const potions = diff(
    { items: [["consumable", "Potion of Healing"]] },
    { items: [["consumable", "Potion of Healing"], ["consumable", "Potion of Healing"]] }
  );
  check("a second copy of the same item", potions.items.length, 1);

  check("a size a species set", diff(empty, { size: "sml" }).size, "sml");
  check("a size that did not change", diff(empty, empty), null);

  const languages = diff({ languages: ["common"] }, { languages: ["common", "elvish"] });
  check("languages read out of the Set", languages.languages, ["elvish"]);

  // --- grouping ---------------------------------------------------------------

  const sections = gainSections(record, { skipTypes: ["class", "subclass"] });
  const byKey = Object.fromEntries(
    sections.map((s) => [s.key, s.entries.map((e) => e.label)])
  );

  check("the sections a card draws", sections.map((s) => s.key),
    ["stats", "proficiencies", "languages", "features", "spells", "gear"]);
  check("the class itself is not repeated inside its own card", byKey.features, ["Spellcasting"]);

  // The headings are the only thing left saying where any of this came from,
  // the card having no title of its own - so the features one is named after
  // the step rather than being "Features" three times over.
  const heading = (kind) =>
    gainSections(record, { kind }).find((s) => s.key === "features").label;
  check("a class names its features", heading("class"), "Class features");
  check("a species names its own", heading("species"), "Species traits");
  check("a step with no kind falls back", heading(""), "Features");
  check("spells stand apart from features", byKey.spells, ["Guidance"]);
  check("equipment and coins together", byKey.gear, ["Chain Mail", "Mace", "GP"]);

  // Empty sections are dropped rather than drawn as a heading with nothing
  // under it - a card of headings says less than no card.
  check("a card with one thing in it",
    gainSections(diff(empty, { languages: ["dwarvish"] })).map((s) => s.key), ["languages"]);
  check("no record, no card", gainSections(null), []);

  // Anything of a type this file does not know still gets shown. A card that
  // silently drops an item would be worse than an untidy one.
  const odd = gainSections(diff(empty, { items: [["shipwreck", "Sloop"]] }));
  check("an unknown item type is still shown", odd.map((s) => s.key), ["other"]);
});

// --- ability scores and languages, now that the arithmetic is testable --------
//
// These used to be methods on two ApplicationV2 subclasses, which meant point
// buy could only be checked by opening a window in Foundry. Pulled out into
// abilities-core.mjs and languages-core.mjs so the guide panel could draw the
// same choice on a card, they can be checked here - which is the point of
// having pulled them out.

await group("ability scores", async () => {
  // The stub declares no abilities, and every function here walks that list.
  const savedAbilities = CONFIG.DND5E.abilities;
  CONFIG.DND5E.abilities = {
    str: { label: "Strength" }, dex: { label: "Dexterity" }, con: { label: "Constitution" },
    int: { label: "Intelligence" }, wis: { label: "Wisdom" }, cha: { label: "Charisma" }
  };

  const actor = (over = {}) => ({
    id: "a1",
    items: over.items ?? [],
    system: { abilities: over.abilities ?? {}, attributes: over.attributes ?? {} },
    getFlag: () => over.flag ?? null,
    update: over.update ?? (async () => {})
  });

  const assigned = () => {
    const state = newState();
    // The standard array in order, so each ability takes a different entry.
    ["str", "dex", "con", "int", "wis", "cha"].forEach((key, i) => (state.assign[key] = i));
    return state;
  };

  check("a fresh state is the standard array", newState().pool, STANDARD_ARRAY);
  check("nothing assigned is not ready", isReady(newState(), actor()), false);
  check("every ability assigned is ready", isReady(assigned(), actor()), true);
  check("no character, never ready", isReady(assigned(), null), false);
  check("the assigned value is the pool entry", baseValue(assigned(), "str"), 15);

  // Point buy: eight everywhere costs nothing, and 15 costs 9 of the 27.
  const pb = newState();
  pb.method = "pointbuy";
  check("all eights spend nothing", pointsSpent(pb), 0);
  pb.direct.str = 15;
  check("a 15 costs nine", pointsSpent(pb), 9);
  check("under budget is ready", isReady(pb, actor()), true);
  for (const key of ["dex", "con", "int", "wis", "cha"]) pb.direct[key] = 15;
  check("over budget is not ready", isReady(pb, actor()), false);
  check("the budget itself", POINT_BUY_TOTAL, 27);

  // The stepper stops where the method says, not where the score could go.
  const stepping = newState();
  stepping.method = "pointbuy";
  stepping.direct.str = 15;
  stepAbility(stepping, "str", 1);
  check("point buy stops at fifteen", stepping.direct.str, 15);
  stepping.method = "manual";
  stepAbility(stepping, "str", 1);
  check("manual goes past it", stepping.direct.str, 16);
  stepping.direct.dex = 1;
  stepAbility(stepping, "dex", -1);
  check("nothing goes below one", stepping.direct.dex, 1);

  // Changing method drops the assignment: the pool it referred to is gone.
  const switched = assigned();
  setMethod(switched, "pointbuy");
  check("switching method clears the assignment", switched.assign.str, null);

  // The bonus already on the sheet. "advancements" reads the items and ignores
  // the scores; "none" refuses to guess at all.
  const withAsi = actor({
    items: [{ system: { advancement: [{ type: "AbilityScoreImprovement", value: { assignments: { str: 2 } } }] } }],
    abilities: { str: { value: 17 } }
  });
  check("an increase is read from the item", existingBonus(withAsi, "str", "advancements"), 2);
  check("an ability with no increase gets none", existingBonus(withAsi, "dex", "advancements"), 0);
  check("ignoring bonuses means zero", existingBonus(withAsi, "str", "none"), 0);
  check("no items, nothing to read", existingBonus(actor(), "str", "advancements"), 0);

  // The row is what the card and the popup both draw: base plus bonus, capped.
  const rows = buildRows(withAsi, assigned(), "advancements");
  const str = rows.find((r) => r.key === "str");
  check("the row adds the bonus underneath", [str.base, str.bonus, str.final], [15, 2, 17]);
  check("and states the modifier", str.modLabel, "+3");
  check("a value used elsewhere is disabled here", rows[1].options[0].disabled, true);

  // Twenty is the ceiling, however the arithmetic gets there.
  const high = actor({
    items: [{ system: { advancement: [{ type: "AbilityScoreImprovement", value: { assignments: { str: 8 } } }] } }]
  });
  check("nothing goes above twenty", buildRows(high, assigned(), "advancements")[0].final, 20);

  // The write: scores, the flag that records the base, and no half-answers.
  let written = null;
  const target = actor({ update: async (data) => (written = data) });
  check("an unfinished assignment writes nothing",
    [await applyAbilities(target, newState(), "none"), written], [false, null]);
  await applyAbilities(target, assigned(), "none");
  check("the score is written", written["system.abilities.str.value"], 15);
  check("and the base is remembered",
    written["flags.prosty-kreator-5e.abilities"].base.str, 15);

  CONFIG.DND5E.abilities = savedAbilities;
});

await group("languages", async () => {
  const savedLanguages = CONFIG.DND5E.languages;
  // Shaped the way dnd5e shapes it: groups with children, each child an object
  // carrying a label. The bare-string form the flattener also accepts is a
  // fallback for a flat config and deliberately not what is measured here.
  CONFIG.DND5E.languages = {
    standard: {
      label: "Standard",
      children: {
        common: { label: "Common" },
        elvish: { label: "Elvish" },
        dwarvish: { label: "Dwarvish" }
      }
    },
    exotic: { label: "Exotic", children: { draconic: { label: "Draconic" } } }
  };

  const flat = flattenLanguages();
  check("a nested config is flattened", flat.length, 4);
  check("and the parent is kept in the label",
    flat.find((l) => l.key === "draconic").label, "Exotic / Draconic");
  check("a name finds its key", keyForName("Elvish"), "elvish");
  check("a name the system does not list finds nothing", keyForName("Thieves' Cant"), null);

  // Common leads, whatever order the sheet stored them in.
  check("Common is named first",
    languageLabels(["elvish", "common", "dwarvish"]), ["Common", "Dwarvish", "Elvish"]);
  check("an unknown key is shown rather than dropped",
    languageLabels(["klingon"]), ["klingon"]);

  const actor = (known = []) => ({
    id: "a1",
    system: { traits: { languages: { value: known } } },
    update: async () => {}
  });

  check("Common is always in the selection",
    Array.from(selectionFor(actor([]))), ["common"]);
  check("what the sheet knows is carried in",
    Array.from(selectionFor(actor(["elvish"]))).sort(), ["common", "elvish"]);

  // Common does not count towards the two, and cannot be unticked.
  const view = buildLanguageView(new Set(["common", "elvish", "dwarvish"]));
  check("Common is not one of the two", view.extras, 2);
  check("two is not over the limit", view.overLimit, false);
  check("Common cannot be unticked",
    view.groups.flatMap((g) => g.languages).find((l) => l.key === "common").locked, true);
  check("three is", buildLanguageView(new Set(["common", "elvish", "dwarvish", "draconic"])).overLimit, true);

  // A roll marks the row it landed on, and says how many times.
  const rolled = buildLanguageView(new Set(["common"]), [5, 5]);
  const elvishRow = rolled.table.find((row) => row.name === "Elvish");
  check("the rolled row is marked", [elvishRow.highlight, elvishRow.hitCount], [true, 2]);

  let written = null;
  const target = { id: "a1", system: { traits: { languages: { value: [] } } },
                   update: async (data) => (written = data) };
  await applyLanguages(target, new Set(["elvish"]));
  check("Common is put back before saving",
    written["system.traits.languages.value"].sort(), ["common", "elvish"]);
  check("and the count includes it",
    written["flags.prosty-kreator-5e.languages"].count, 2);

  CONFIG.DND5E.languages = savedLanguages;
});

// --- result ------------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`\n${failures.map((f) => `  ${f}`).join("\n\n")}`);
  process.exit(1);
}
