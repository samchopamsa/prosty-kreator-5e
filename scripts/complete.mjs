/**
 * complete.mjs
 * ---------------------------------------------------------------------------
 * "Complete character" mode.
 *
 * Importers build a nearly finished sheet - class, species,
 * background, features, equipment, hit points - but never ask for ability
 * scores. This screen fills that gap on an existing actor.
 *
 * The arithmetic is not here: it lives in abilities-core.mjs, which the guide
 * panel's own inline step draws from as well. This file is the window - the
 * character picker, the listeners and the notifications. Anything about what a
 * score should come out as belongs next door.
 */

import { MODULE_ID } from "./constants.mjs";
import { preserveScroll, applyTheme } from "./ui.mjs";
import {
  POINT_BUY_TOTAL,
  abilityKeys,
  applyAbilities,
  buildRows,
  detectBonuses,
  isReady,
  newState,
  pointsSpent,
  rollPool,
  savedState,
  setMethod,
  stateFor,
  stepAbility
} from "./abilities-core.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    /** Opened from a specific sheet: the character is fixed, so hide the picker. */
    this.locked = !!options.actorId;
    /** { method, pool, assign, direct } - see abilities-core.mjs. */
    this.state = newState();
    // Chosen once in the module settings rather than per character: it is a
    // decision about how the world is run, not about this one sheet.
    this.bonusMode = game.settings.get(MODULE_ID, "bonusMode") ?? "advancements";
    /** Which actor the stored state was loaded for, so we load it only once. */
    this._loadedFor = null;
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
    return abilityKeys();
  }

  get actor() {
    return this.actorId ? game.actors.get(this.actorId) : null;
  }

  /** What this screen saved on its last run, or null the first time. */
  get savedState() {
    return savedState(this.actor);
  }

  /** Restores the previous assignment so reopening shows what was chosen. */
  loadSavedState() {
    if (!this.actor || this._loadedFor === this.actorId) return;
    this._loadedFor = this.actorId;
    this.state = stateFor(this.actor);
  }

  async _prepareContext() {
    this.loadSavedState();
    const actor = this.actor;
    const bonuses = detectBonuses(actor);
    const method = this.state.method;

    return {
      locked: this.locked,
      actors: this.locked
        ? []
        : game.actors
        .filter((a) => a.type === "character" && a.isOwner)
        .map((a) => ({ id: a.id, name: a.name, selected: a.id === this.actorId }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      hasActor: !!actor,
      bonusSource: bonuses.source,
      bonusFound: bonuses.source === "advancement",
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
      isStandard: method === "standard",
      isRoll: method === "roll",
      isPointBuy: method === "pointbuy",
      isManual: method === "manual",
      usesPool: method === "standard" || method === "roll",
      rows: buildRows(actor, this.state, this.bonusMode),
      pointsLeft: POINT_BUY_TOTAL - pointsSpent(this.state),
      pointsTotal: POINT_BUY_TOTAL,
      canApply: isReady(this.state, actor)
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-pane"]);

    const el = this.element;

    el.querySelector("select[data-actor]")?.addEventListener("change", (ev) => {
      this.actorId = ev.currentTarget.value || null;
      this._loadedFor = null;
      this.render();
    });

    el.querySelectorAll("[data-method]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        setMethod(this.state, ev.currentTarget.dataset.method);
        this.render();
      });
    });

    el.querySelectorAll("select[data-assign]").forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.assign;
        const raw = ev.currentTarget.value;
        this.state.assign[key] = raw === "" ? null : Number(raw);
        this.render();
      });
    });

    el.querySelectorAll("input[data-manual]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.manual;
        this.state.direct[key] = Math.min(20, Math.max(1, Number(ev.currentTarget.value) || 10));
        this.render();
      });
    });

  }

  static onAbilityPlus(event, target) {
    stepAbility(this.state, target.dataset.ability, +1);
    this.render();
  }

  static onAbilityMinus(event, target) {
    stepAbility(this.state, target.dataset.ability, -1);
    this.render();
  }

  static async onRoll() {
    const values = await rollPool();
    this.state.method = "roll";
    this.state.pool = values;
    for (const k of abilityKeys()) this.state.assign[k] = null;
    ui.notifications.info(`Rolled: ${values.join(", ")}`);
    this.render();
  }

  static onReset() {
    const method = this.state.method;
    this.state = newState();
    this.state.method = method;
    this.render();
  }

  static async onApply() {
    const actor = this.actor;
    if (!actor) return;

    try {
      if (!(await applyAbilities(actor, this.state, this.bonusMode))) return;

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
