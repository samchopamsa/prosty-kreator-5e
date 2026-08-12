/**
 * complete.mjs
 * ---------------------------------------------------------------------------
 * "Complete character" mode.
 *
 * Importers such as Plutonium build a nearly finished sheet - class, species,
 * background, features, equipment, hit points - but never ask for ability
 * scores. This screen fills that gap on an existing actor.
 *
 * IMPORTANT: a background's ability score increase is written straight into
 * system.abilities.X.value, not kept as a separate bonus. Overwriting the score
 * would silently destroy it. We therefore read whatever sits above 10 as an
 * existing bonus and add the player's assignment underneath it, showing the
 * arithmetic before anything is saved.
 */

import { MODULE_ID } from "./sources.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const POINT_BUY_TOTAL = 27;

/** CONFIG.DND5E.languages may be flat or nested; flatten either shape. */
function flattenLanguages(node = CONFIG.DND5E?.languages ?? {}, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      out.push({ key, label: value });
      continue;
    }
    const label = value?.label ?? key;
    if (value?.children) {
      out.push(...flattenLanguages(value.children, `${prefix}${label} / `));
    } else {
      out.push({ key, label: `${prefix}${label}` });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export class CompleteCharacter extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId ?? null;
    this.method = "standard";
    this.pool = [...STANDARD_ARRAY];
    this.assign = {};
    this.direct = {};
    this.keepBonuses = true;
    this.languages = null;
    for (const key of this.abilityKeys) {
      this.assign[key] = null;
      this.direct[key] = 8;
    }
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-complete",
    tag: "div",
    classes: ["pk5e-creator"],
    window: {
      title: "Complete Character",
      icon: "fa-solid fa-wand-magic-sparkles",
      resizable: true
    },
    position: { width: 640, height: 720 },
    actions: {
      abilityPlus: CompleteCharacter.onAbilityPlus,
      abilityMinus: CompleteCharacter.onAbilityMinus,
      rollAbilities: CompleteCharacter.onRoll,
      reset: CompleteCharacter.onReset,
      apply: CompleteCharacter.onApply
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/complete.hbs` }
  };

  get abilityKeys() {
    return Object.keys(
      CONFIG.DND5E?.abilities ?? { str: {}, dex: {}, con: {}, int: {}, wis: {}, cha: {} }
    );
  }

  get actor() {
    return this.actorId ? game.actors.get(this.actorId) : null;
  }

  /** Whatever sits above 10 is treated as an already-applied bonus. */
  existingBonus(key) {
    if (!this.keepBonuses || !this.actor) return 0;
    const current = this.actor.system?.abilities?.[key]?.value ?? 10;
    return Math.max(0, current - 10);
  }

  baseValue(key) {
    if (this.method === "standard" || this.method === "roll") {
      const idx = this.assign[key];
      return idx === null || idx === undefined ? null : this.pool[idx];
    }
    return Number(this.direct[key]) || 0;
  }

  pointsSpent() {
    return this.abilityKeys.reduce(
      (sum, k) => sum + (POINT_BUY_COST[this.direct[k]] ?? 0),
      0
    );
  }

  isReady() {
    if (!this.actor) return false;
    if (this.method === "standard" || this.method === "roll") {
      return this.abilityKeys.every((k) => this.assign[k] !== null);
    }
    if (this.method === "pointbuy") return this.pointsSpent() <= POINT_BUY_TOTAL;
    return this.abilityKeys.every((k) => {
      const v = Number(this.direct[k]);
      return Number.isFinite(v) && v >= 1 && v <= 20;
    });
  }

  async _prepareContext() {
    const actor = this.actor;
    const used = new Set(Object.values(this.assign).filter((v) => v !== null));

    const rows = this.abilityKeys.map((key) => {
      const cfg = CONFIG.DND5E?.abilities?.[key] ?? {};
      const base = this.baseValue(key);
      const bonus = this.existingBonus(key);
      const final = base === null ? null : Math.min(20, base + bonus);
      const mod = final === null ? null : Math.floor((final - 10) / 2);
      return {
        key,
        label: cfg.label ?? key.toUpperCase(),
        current: actor?.system?.abilities?.[key]?.value ?? "—",
        base,
        bonus,
        bonusLabel: bonus ? `+${bonus}` : "—",
        final: final ?? "—",
        modLabel: mod === null ? "—" : mod >= 0 ? `+${mod}` : `${mod}`,
        options: this.pool.map((v, i) => ({
          index: i,
          value: v,
          selected: this.assign[key] === i,
          disabled: used.has(i) && this.assign[key] !== i
        })),
        minusDisabled: this.method === "pointbuy" ? this.direct[key] <= 8 : this.direct[key] <= 1,
        plusDisabled: this.method === "pointbuy" ? this.direct[key] >= 15 : this.direct[key] >= 20,
        value: this.direct[key]
      };
    });

    const known = actor?.system?.traits?.languages?.value;
    const current = this.languages ?? new Set(known ? Array.from(known) : []);
    this.languages = current;

    return {
      actors: game.actors
        .filter((a) => a.type === "character" && a.isOwner)
        .map((a) => ({ id: a.id, name: a.name, selected: a.id === this.actorId }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      hasActor: !!actor,
      actorName: actor?.name ?? "",
      summary: actor
        ? [
            actor.items.find((i) => i.type === "class")?.name,
            actor.items.find((i) => i.type === "race" || i.type === "species")?.name,
            actor.items.find((i) => i.type === "background")?.name
          ]
            .filter(Boolean)
            .join(" · ")
        : "",
      keepBonuses: this.keepBonuses,
      isStandard: this.method === "standard",
      isRoll: this.method === "roll",
      isPointBuy: this.method === "pointbuy",
      isManual: this.method === "manual",
      usesPool: this.method === "standard" || this.method === "roll",
      rows,
      pointsLeft: POINT_BUY_TOTAL - this.pointsSpent(),
      pointsTotal: POINT_BUY_TOTAL,
      languages: flattenLanguages().map((l) => ({
        ...l,
        checked: current.has(l.key)
      })),
      canApply: this.isReady()
    };
  }

  _onRender() {
    const el = this.element;

    el.querySelector("select[data-actor]")?.addEventListener("change", (ev) => {
      this.actorId = ev.currentTarget.value || null;
      this.languages = null;
      this.render();
    });

    el.querySelector("input[data-keep-bonuses]")?.addEventListener("change", (ev) => {
      this.keepBonuses = ev.currentTarget.checked;
      this.render();
    });

    el.querySelectorAll("[data-method]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        this.method = ev.currentTarget.dataset.method;
        if (this.method === "standard") this.pool = [...STANDARD_ARRAY];
        for (const k of this.abilityKeys) this.assign[k] = null;
        this.render();
      });
    });

    el.querySelectorAll("select[data-assign]").forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.assign;
        const raw = ev.currentTarget.value;
        this.assign[key] = raw === "" ? null : Number(raw);
        this.render();
      });
    });

    el.querySelectorAll("input[data-manual]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.manual;
        this.direct[key] = Math.min(20, Math.max(1, Number(ev.currentTarget.value) || 10));
        this.render();
      });
    });

    el.querySelectorAll("input[data-language]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.language;
        if (ev.currentTarget.checked) this.languages.add(key);
        else this.languages.delete(key);
      });
    });
  }

  static onAbilityPlus(event, target) {
    const key = target.dataset.ability;
    const max = this.method === "pointbuy" ? 15 : 20;
    if (this.direct[key] < max) this.direct[key] += 1;
    this.render();
  }

  static onAbilityMinus(event, target) {
    const key = target.dataset.ability;
    const min = this.method === "pointbuy" ? 8 : 1;
    if (this.direct[key] > min) this.direct[key] -= 1;
    this.render();
  }

  static async onRoll() {
    const values = [];
    for (let i = 0; i < 6; i++) {
      const roll = await new Roll("4d6dl1").evaluate();
      values.push(roll.total);
    }
    values.sort((a, b) => b - a);
    this.method = "roll";
    this.pool = values;
    for (const k of this.abilityKeys) this.assign[k] = null;
    ui.notifications.info(`Rolled: ${values.join(", ")}`);
    this.render();
  }

  static onReset() {
    this.pool = [...STANDARD_ARRAY];
    for (const k of this.abilityKeys) {
      this.assign[k] = null;
      this.direct[k] = 8;
    }
    this.render();
  }

  static async onApply() {
    const actor = this.actor;
    if (!actor || !this.isReady()) return;

    const update = {};
    for (const key of this.abilityKeys) {
      const base = this.baseValue(key);
      if (base === null) continue;
      update[`system.abilities.${key}.value`] = Math.min(20, base + this.existingBonus(key));
    }
    if (this.languages) {
      update["system.traits.languages.value"] = Array.from(this.languages);
    }

    try {
      await actor.update(update);
      ui.notifications.info(`Updated "${actor.name}".`);
      this.close();
      actor.sheet.render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not update actor`, err);
      ui.notifications.error(`Character Creator: ${err.message}`);
    }
  }
}
