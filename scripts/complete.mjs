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

import { MODULE_ID } from "./constants.mjs";
import { preserveScroll, applyTheme } from "./ui.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const POINT_BUY_TOTAL = 27;

/**
 * Puts the sheet back into play mode once the character is finished, so the
 * player is not left looking at the editing interface.
 */
function returnToPlayMode(actor) {
  setTimeout(() => {
    try {
      const sheet = actor.sheet;
      const MODES = sheet?.constructor?.MODES;
      if (!sheet?.rendered || MODES?.PLAY === undefined) return;
      if (sheet._mode === MODES.PLAY) return;
      sheet.element?.querySelector("[data-action='changeMode']")?.click();
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not switch the sheet back to play mode`, err);
    }
  }, 350);
}

export class CompleteCharacter extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId ?? null;
    /** Opened from a specific sheet: the character is fixed, not selectable. */
    this.locked = !!options.actorId;
    /** Opened from a sheet: the character is fixed, so hide the picker. */
    this.locked = !!options.actorId;
    this.method = "standard";
    this.pool = [...STANDARD_ARRAY];
    this.assign = {};
    this.direct = {};
    // Chosen once in the module settings rather than per character: it is a
    // decision about how the world is run, not about this one sheet.
    this.bonusMode = game.settings.get(MODULE_ID, "bonusMode") ?? "advancements";
    /** Which actor the stored state was loaded for, so we load it only once. */
    this._loadedFor = null;
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

  /** What this screen saved on its last run, or null the first time. */
  get savedState() {
    return this.actor?.getFlag(MODULE_ID, "abilities") ?? null;
  }

  /** Restores the previous assignment so reopening shows what was chosen. */
  loadSavedState() {
    if (!this.actor || this._loadedFor === this.actorId) return;
    this._loadedFor = this.actorId;

    const saved = this.savedState;
    if (!saved) return;

    if (saved.method) this.method = saved.method;
    if (Array.isArray(saved.pool) && saved.pool.length) this.pool = [...saved.pool];
    for (const key of this.abilityKeys) {
      if (saved.assign) this.assign[key] = saved.assign[key] ?? null;
      if (saved.direct) this.direct[key] = saved.direct[key] ?? 8;
    }
  }

  /**
   * Ability increases already applied to the sheet.
   *
   * Read from the actual AbilityScoreImprovement advancements on the character's
   * items. Falling back to "anything above 10 is a bonus" was wrong for sheets
   * that already had proper scores - it treated 15 as a +5 increase.
   */
  detectBonuses() {
    if (this._bonusCache?.actorId === this.actorId) return this._bonusCache;

    const actor = this.actor;
    const result = { actorId: this.actorId, values: {}, source: "none" };
    if (!actor) return (this._bonusCache = result);

    for (const item of actor.items) {
      for (const adv of item.system?.advancement ?? []) {
        if (adv.type !== "AbilityScoreImprovement") continue;
        const value = adv.value ?? {};
        const assignments = value.assignments ?? value.abilities ?? {};
        for (const [key, raw] of Object.entries(assignments)) {
          const amount = Number(raw);
          if (Number.isFinite(amount) && amount > 0) {
            result.values[key] = (result.values[key] ?? 0) + amount;
          }
        }
      }
    }

    if (Object.keys(result.values).length) result.source = "advancement";
    return (this._bonusCache = result);
  }

  /**
   * The bonus already on the sheet, by decreasing reliability:
   *
   * 1. If this screen ran before, the difference between the current score and
   *    the base we wrote IS the bonus. Exact, and it picks up later increases.
   * 2. Otherwise, the ability score improvements declared on the actor's items.
   * 3. Otherwise, the old guess: anything above 10.
   */
  existingBonus(key) {
    if (!this.actor || this.bonusMode === "none") return 0;

    // Reading straight from the advancements ignores whatever is currently on
    // the sheet. That is the point: increases left behind by an importer when an
    // item was deleted quietly inflate the scores, and measuring against the
    // sheet would faithfully preserve that inflation.
    if (this.bonusMode === "advancements") {
      return this.detectBonuses().values[key] ?? 0;
    }

    const current = this.actor.system?.abilities?.[key]?.value ?? 10;
    const lastBase = this.savedState?.base?.[key];
    if (Number.isFinite(lastBase)) return Math.max(0, current - lastBase);

    const detected = this.detectBonuses();
    if (detected.source === "advancement") return detected.values[key] ?? 0;

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
    this.loadSavedState();
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


    return {
      locked: this.locked,
      actors: this.locked
        ? []
        : game.actors
        .filter((a) => a.type === "character" && a.isOwner)
        .map((a) => ({ id: a.id, name: a.name, selected: a.id === this.actorId }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      hasActor: !!actor,
      locked: this.locked,
      bonusSource: this.detectBonuses().source,
      bonusFound: this.detectBonuses().source === "advancement",
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
      bonusMode: this.bonusMode,
      isMeasured: this.bonusMode === "measured",
      isFromAdvancements: this.bonusMode === "advancements",
      isIgnored: this.bonusMode === "none",
      hasSavedState: !!this.savedState,
      savedAt: this.savedState?.appliedAt
        ? new Date(this.savedState.appliedAt).toLocaleString()
        : null,
      isStandard: this.method === "standard",
      isRoll: this.method === "roll",
      isPointBuy: this.method === "pointbuy",
      isManual: this.method === "manual",
      usesPool: this.method === "standard" || this.method === "roll",
      rows,
      pointsLeft: POINT_BUY_TOTAL - this.pointsSpent(),
      pointsTotal: POINT_BUY_TOTAL,
      canApply: this.isReady()
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-pane"]);

    const el = this.element;

    el.querySelector("select[data-actor]")?.addEventListener("change", (ev) => {
      this.actorId = ev.currentTarget.value || null;
      this._bonusCache = null;
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
    const base = {};
    for (const key of this.abilityKeys) {
      const value = this.baseValue(key);
      if (value === null) continue;
      base[key] = value;
      update[`system.abilities.${key}.value`] = Math.min(20, value + this.existingBonus(key));
    }
    // Remember the base scores we wrote. Next time the bonus is derived from
    // the difference against these, so nothing is ever counted twice.
    update[`flags.${MODULE_ID}.abilities`] = {
      method: this.method,
      pool: [...this.pool],
      assign: { ...this.assign },
      direct: { ...this.direct },
      base,
      appliedAt: Date.now()
    };

    try {
      await actor.update(update);

      // Constitution may have changed, so maximum hit points are only correct
      // after the first update has been applied. Then top the character up.
      const max = Number(actor.system?.attributes?.hp?.max ?? 0);
      const value = Number(actor.system?.attributes?.hp?.value ?? 0);
      if (max > 0 && value < max) {
        await actor.update({ "system.attributes.hp.value": max });
      }

      ui.notifications.info(`Updated "${actor.name}".`);
      // Closes this popup only. The guide panel behind it stays open.
      //
      // The sheet is NOT re-rendered here: Foundry refreshes open sheets on its
      // own after an update, and render(true) additionally pulls the sheet in
      // front of the panel the player was working in.
      this.close();
      returnToPlayMode(actor);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not update actor`, err);
      ui.notifications.error(`Character Creator: ${err.message}`);
    }
  }
}
