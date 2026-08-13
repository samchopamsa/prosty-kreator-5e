/**
 * languages.mjs
 * ---------------------------------------------------------------------------
 * Language selection, as its own step.
 *
 * This used to be tucked away inside the ability score screen, where players
 * simply did not find it. It is now a step of its own, with the rule text and
 * the Standard Languages table from the Player's Handbook.
 *
 * Common is always known and cannot be unticked. Two further languages are the
 * expected number; taking more is allowed but asks for confirmation first, so
 * nobody grants themselves five languages by accident.
 */

import { MODULE_ID } from "./constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The Standard Languages table (1d12). Common is automatic, hence no roll. */
const STANDARD_TABLE = [
  { roll: "—", name: "Common", origin: "Sigil", min: 0, max: 0 },
  { roll: "1", name: "Common Sign Language", origin: "Sigil", min: 1, max: 1 },
  { roll: "2", name: "Draconic", origin: "Dragons", min: 2, max: 2 },
  { roll: "3-4", name: "Dwarvish", origin: "Dwarves", min: 3, max: 4 },
  { roll: "5-6", name: "Elvish", origin: "Elves", min: 5, max: 6 },
  { roll: "7", name: "Giant", origin: "Giants", min: 7, max: 7 },
  { roll: "8", name: "Gnomish", origin: "Gnomes", min: 8, max: 8 },
  { roll: "9", name: "Goblin", origin: "Goblinoids", min: 9, max: 9 },
  { roll: "10-11", name: "Halfling", origin: "Halflings", min: 10, max: 11 },
  { roll: "12", name: "Orc", origin: "Orcs", min: 12, max: 12 }
];

/** Languages the 2024 rules list as standard. Everything else is "Expanded". */
const CORE_NAMES = STANDARD_TABLE.map((entry) => entry.name);

const normalise = (value) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** CONFIG.DND5E.languages may be flat or nested; flatten either shape. */
function flattenLanguages(node = CONFIG.DND5E?.languages ?? {}, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      out.push({ key, label: value, plainLabel: value });
      continue;
    }
    const label = value?.label ?? key;
    if (value?.children) {
      out.push(...flattenLanguages(value.children, `${prefix}${label} / `));
    } else {
      out.push({ key, label: `${prefix}${label}`, plainLabel: label });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Finds the config key matching a language name from the table. */
function keyForName(name) {
  const target = normalise(name);
  const hit = flattenLanguages().find(
    (entry) => normalise(entry.key) === target || normalise(entry.plainLabel) === target
  );
  return hit?.key ?? null;
}

export function commonKey() {
  return keyForName("Common");
}

async function confirmExtra(message) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    try {
      return await DialogV2.confirm({
        window: { title: "More languages than usual" },
        content: `<p>${message}</p>`,
        modal: true
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | DialogV2 unavailable, falling back`, err);
    }
  }
  return window.confirm(message);
}

export class LanguagePicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId ?? null;
    this.selected = null;
    this.lastRoll = null;
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-languages",
    tag: "div",
    classes: ["pk5e-creator"],
    window: { title: "Languages", icon: "fa-solid fa-comments", resizable: true },
    position: { width: 620, height: 700 },
    actions: {
      rollLanguage: LanguagePicker.onRoll,
      apply: LanguagePicker.onApply
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/languages.hbs` }
  };

  get actor() {
    return this.actorId ? game.actors.get(this.actorId) : null;
  }

  /** Current selection, seeded from the sheet, with Common always included. */
  get languages() {
    if (!this.selected) {
      const known = this.actor?.system?.traits?.languages?.value;
      this.selected = new Set(known ? Array.from(known) : []);
      const common = commonKey();
      if (common) this.selected.add(common);
    }
    return this.selected;
  }

  async _prepareContext() {
    const common = commonKey();
    const chosen = this.languages;

    const all = flattenLanguages().map((entry) => ({
      key: entry.key,
      label: entry.label,
      checked: chosen.has(entry.key),
      locked: entry.key === common,
      search: `${entry.label} ${entry.key}`.toLowerCase(),
      core: CORE_NAMES.some((name) => normalise(name) === normalise(entry.plainLabel))
    }));

    const extras = Array.from(chosen).filter((key) => key !== common).length;

    return {
      actorName: this.actor?.name ?? "",
      hasActor: !!this.actor,
      table: STANDARD_TABLE.map((entry) => ({
        ...entry,
        automatic: entry.min === 0,
        known: chosen.has(keyForName(entry.name)),
        highlight: this.lastRoll !== null && this.lastRoll >= entry.min && this.lastRoll <= entry.max
      })),
      lastRoll: this.lastRoll,
      groups: [
        { label: "Standard Languages", languages: all.filter((l) => l.core) },
        { label: "Expanded", languages: all.filter((l) => !l.core) }
      ].filter((group) => group.languages.length),
      extras,
      overLimit: extras > 2
    };
  }

  _onRender() {
    const el = this.element;

    el.querySelectorAll("input[data-language]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.language;
        if (ev.currentTarget.checked) this.languages.add(key);
        else this.languages.delete(key);
        this.render();
      });
    });

    const search = el.querySelector("[data-language-search]");
    if (search) {
      search.addEventListener("input", (ev) => {
        const query = ev.currentTarget.value.trim().toLowerCase();
        el.querySelectorAll(".pk5e-lang-group").forEach((group) => {
          let visible = 0;
          group.querySelectorAll(".pk5e-pack").forEach((row) => {
            const match = !query || row.dataset.search.includes(query);
            row.style.display = match ? "" : "none";
            if (match) visible += 1;
          });
          group.style.display = visible ? "" : "none";
        });
      });
    }
  }

  static async onRoll() {
    const roll = await new Roll("1d12").evaluate();
    this.lastRoll = roll.total;

    const entry = STANDARD_TABLE.find((row) => roll.total >= row.min && roll.total <= row.max);
    if (!entry) return this.render();

    const key = keyForName(entry.name);
    if (!key) {
      ui.notifications.warn(`Rolled ${roll.total}: ${entry.name}, which this system does not list.`);
      return this.render();
    }

    if (this.languages.has(key)) {
      ui.notifications.info(`Rolled ${roll.total}: ${entry.name} - already known, roll again.`);
    } else {
      this.languages.add(key);
      ui.notifications.info(`Rolled ${roll.total}: ${entry.name} added.`);
    }
    this.render();
  }

  static async onApply() {
    const actor = this.actor;
    if (!actor) return;

    const common = commonKey();
    if (common) this.languages.add(common);

    const extras = Array.from(this.languages).filter((key) => key !== common).length;
    if (extras > 2) {
      const ok = await confirmExtra(
        `A character normally knows Common plus two more languages. You have chosen ${extras}. Keep them all?`
      );
      if (!ok) return;
    }

    try {
      await actor.update({
        "system.traits.languages.value": Array.from(this.languages),
        [`flags.${MODULE_ID}.languages`]: { count: extras + 1, appliedAt: Date.now() }
      });
      ui.notifications.info(`Languages saved for "${actor.name}".`);
      this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not save languages`, err);
      ui.notifications.error(`Could not save languages: ${err.message}`);
    }
  }
}
