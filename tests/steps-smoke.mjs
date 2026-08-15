/**
 * tests/steps-smoke.mjs
 * ---------------------------------------------------------------------------
 * Runs buildSteps() against a stand-in character.
 *
 * Syntax checking says nothing about a name that moved to another file, which
 * is exactly what happens when code is split up - this caught three of them the
 * first time it was run. Not a test of behaviour so much as proof the module
 * can be executed at all.
 *
 *   node tests/steps-smoke.mjs
 */
globalThis.foundry = { applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} }, instances: new Map(), ux: { TextEditor: { implementation: { enrichHTML: async (h) => h } } } } };
globalThis.game = {
  settings: { get: (m, k) => ({ showStepHelp: true, autoAdvance: "off", levelUpMode: "milestone" }[k] ?? "") },
  user: { isGM: true },
  i18n: { localize: (k) => k },
  modules: { get: () => null }
};
globalThis.CONFIG = { DND5E: { abilities: {} } };
globalThis.ui = { notifications: { warn: () => {} } };
globalThis.Hooks = { on: () => 0, off: () => {} };

const { buildSteps } = await import("../scripts/steps.mjs");

const item = (type, name, extra = {}) => ({
  id: name, type, name, img: "", system: { description: { value: "<p>Opis.</p>" }, levels: 1, ...extra },
  advancement: null, flags: {}
});
const actor = {
  name: "Test",
  img: "",
  items: [item("class", "Barbarian"), item("race", "Aasimar"), item("background", "Acolyte")],
  system: { abilities: {}, traits: { languages: { value: ["common"] } }, attributes: {}, spells: {} },
  getFlag: (m, k) => (k === "abilities" ? { method: "standard" } : k === "languages" ? true : null),
  ownership: {}
};
actor.items.filter = Array.prototype.filter.bind(actor.items);
actor.items.find = Array.prototype.find.bind(actor.items);

const steps = buildSteps(actor);
console.log("krokow:", steps.length);
console.table(steps.map((s) => ({ nr: s.number, key: s.key, label: s.label, done: s.done, wpisow: (s.entries ?? []).length })));

if (steps.length !== 6) {
  console.error("expected six steps");
  process.exit(1);
}
if (steps.map((s) => s.key).join() !== "class,species,background,abilities,languages,portrait") {
  console.error("steps are in the wrong order");
  process.exit(1);
}
console.log("ok");
