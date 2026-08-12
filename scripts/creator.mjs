/**
 * creator.mjs
 * ---------------------------------------------------------------------------
 * The character creation wizard. Built on ApplicationV2 (Foundry v13+).
 *
 * Steps: Sources -> Species -> Background -> Class -> Abilities -> Summary
 *
 * On "Create Character" the module creates the Actor, sets base ability scores,
 * then adds species, background and class through the system's own Advancement
 * manager - that is what prompts for hit points, proficiencies, starting
 * equipment and spells. We deliberately do not reimplement any of that.
 *
 * NOTE: wizard data lives in `this.wizard`, NOT `this.state`.
 * ApplicationV2 already defines a read-only `state` property (render state).
 */

import { MODULE_ID, getEntries, getPackChoices, getDescriptionHTML } from "./sources.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Step order and labels. */
const STEPS = [
  { key: "intro", label: "Start" },
  { key: "species", label: "Species" },
  { key: "background", label: "Background" },
  { key: "class", label: "Class" },
  { key: "abilities", label: "Abilities" },
  { key: "summary", label: "Summary" }
];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const POINT_BUY_TOTAL = 27;

export class CharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    this.wizard = {
      stepIndex: 0,
      name: "",
      species: null,
      background: null,
      class: null,
      method: game.settings.get(MODULE_ID, "abilityMethod") ?? "standard",
      /** values waiting to be assigned (standard array / rolled) */
      pool: [...STANDARD_ARRAY],
      /** which pool index goes to which ability: {str: 0, dex: 3, ...} */
      assign: {},
      /** direct values for point buy and manual entry */
      direct: {}
    };

    for (const key of this.abilityKeys) {
      this.wizard.assign[key] = null;
      this.wizard.direct[key] = 8;
    }

    this._entryCache = {};
    this._detail = { species: null, background: null, class: null };
    this._busy = false;
  }

  /* ---------------------------------------------------------------------- */

  static DEFAULT_OPTIONS = {
    id: "pk5e-creator",
    tag: "div",
    classes: ["pk5e-creator"],
    window: {
      title: "Character Creator",
      icon: "fa-solid fa-hat-wizard",
      resizable: true
    },
    position: { width: 780, height: 720 },
    actions: {
      goto: CharacterCreator.onGoto,
      next: CharacterCreator.onNext,
      back: CharacterCreator.onBack,
      pick: CharacterCreator.onPick,
      clearPick: CharacterCreator.onClearPick,
      abilityPlus: CharacterCreator.onAbilityPlus,
      abilityMinus: CharacterCreator.onAbilityMinus,
      rollAbilities: CharacterCreator.onRollAbilities,
      resetAbilities: CharacterCreator.onResetAbilities,
      finish: CharacterCreator.onFinish
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/creator.hbs` }
  };

  /* ---------------------------------------------------------------------- */

  /** Ability keys in system order (str, dex, con, int, wis, cha). */
  get abilityKeys() {
    return Object.keys(
      CONFIG.DND5E?.abilities ?? { str: {}, dex: {}, con: {}, int: {}, wis: {}, cha: {} }
    );
  }

  get currentStep() {
    return STEPS[this.wizard.stepIndex].key;
  }

  isStepComplete(key) {
    switch (key) {
      case "intro":
        return !!this.wizard.name?.trim();
      case "species":
        return !!this.wizard.species;
      case "background":
        return !!this.wizard.background;
      case "class":
        return !!this.wizard.class;
      case "abilities":
        return this.abilitiesValid();
      default:
        return true;
    }
  }

  abilitiesValid() {
    const m = this.wizard.method;
    if (m === "standard" || m === "roll") {
      return this.abilityKeys.every((k) => this.wizard.assign[k] !== null);
    }
    if (m === "pointbuy") {
      return this.pointsSpent() <= POINT_BUY_TOTAL;
    }
    return this.abilityKeys.every((k) => {
      const v = Number(this.wizard.direct[k]);
      return Number.isFinite(v) && v >= 1 && v <= 20;
    });
  }

  pointsSpent() {
    return this.abilityKeys.reduce(
      (sum, k) => sum + (POINT_BUY_COST[this.wizard.direct[k]] ?? 0),
      0
    );
  }

  /** Final base scores. Background bonuses are applied later by Advancement. */
  getAbilities() {
    const out = {};
    const m = this.wizard.method;
    for (const k of this.abilityKeys) {
      if (m === "standard" || m === "roll") {
        const idx = this.wizard.assign[k];
        out[k] = idx === null ? 10 : this.wizard.pool[idx];
      } else {
        out[k] = Number(this.wizard.direct[k]) || 10;
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------- */

  async _prepareContext(options) {
    const step = this.currentStep;

    const context = {
      wizard: this.wizard,
      isGM: game.user.isGM,
      step,
      isIntro: step === "intro",
      isAbilities: step === "abilities",
      isSummary: step === "summary",
      isPickStep: ["species", "background", "class"].includes(step),
      busy: this._busy,
      steps: STEPS.map((s, i) => ({
        index: i,
        number: i + 1,
        label: s.label,
        active: i === this.wizard.stepIndex,
        done: i < this.wizard.stepIndex && this.isStepComplete(s.key)
      })),
      canBack: this.wizard.stepIndex > 0,
      canNext: this.isStepComplete(step),
      hint: this.stepHint(step)
    };

    if (step === "intro") {
      context.packs = getPackChoices();
    }

    if (context.isPickStep) {
      context.kind = step;
      context.kindLabel = STEPS[this.wizard.stepIndex].label;
      const entries = await this.getCachedEntries(step);
      const selectedUuid = this.wizard[step]?.uuid ?? null;
      context.list = entries.map((e) => ({ ...e, selected: e.uuid === selectedUuid }));
      context.selected = this.wizard[step];
      context.detail = this._detail[step];
      context.emptyList = entries.length === 0;
    }

    if (step === "abilities") {
      context.abilities = this.prepareAbilitiesContext();
    }

    if (step === "summary") {
      const abilities = this.getAbilities();
      context.summaryAbilities = this.abilityKeys.map((k) => {
        const mod = Math.floor((abilities[k] - 10) / 2);
        return {
          label: (CONFIG.DND5E?.abilities?.[k]?.abbreviation ?? k).toUpperCase(),
          value: abilities[k],
          modLabel: mod >= 0 ? `+${mod}` : `${mod}`
        };
      });
    }

    return context;
  }

  prepareAbilitiesContext() {
    const m = this.wizard.method;
    const usedIndexes = new Set(
      Object.values(this.wizard.assign).filter((v) => v !== null)
    );

    const rows = this.abilityKeys.map((key) => {
      const cfg = CONFIG.DND5E?.abilities?.[key] ?? {};
      const row = {
        key,
        label: cfg.label ?? key.toUpperCase(),
        abbr: (cfg.abbreviation ?? key).toUpperCase()
      };

      if (m === "standard" || m === "roll") {
        row.assigned = this.wizard.assign[key];
        row.value = row.assigned === null ? null : this.wizard.pool[row.assigned];
        row.options = this.wizard.pool.map((v, i) => ({
          index: i,
          value: v,
          selected: this.wizard.assign[key] === i,
          disabled: usedIndexes.has(i) && this.wizard.assign[key] !== i
        }));
      } else {
        row.value = Number(this.wizard.direct[key]);
        row.minusDisabled = m === "pointbuy" ? row.value <= 8 : row.value <= 1;
        row.plusDisabled =
          m === "pointbuy"
            ? row.value >= 15 ||
              this.pointsSpent() -
                (POINT_BUY_COST[row.value] ?? 0) +
                (POINT_BUY_COST[row.value + 1] ?? 99) >
                POINT_BUY_TOTAL
            : row.value >= 20;
      }

      row.mod =
        row.value === null || row.value === undefined
          ? null
          : Math.floor((row.value - 10) / 2);
      row.modLabel = row.mod === null ? "—" : row.mod >= 0 ? `+${row.mod}` : `${row.mod}`;
      return row;
    });

    return {
      method: m,
      isStandard: m === "standard",
      isRoll: m === "roll",
      isPointBuy: m === "pointbuy",
      isManual: m === "manual",
      rows,
      pointsSpent: this.pointsSpent(),
      pointsTotal: POINT_BUY_TOTAL,
      pointsLeft: POINT_BUY_TOTAL - this.pointsSpent()
    };
  }

  stepHint(step) {
    switch (step) {
      case "intro":
        return "Enter a name. Below you can check which compendiums the creator reads from.";
      case "species":
        return "Your species determines speed, size and innate traits.";
      case "background":
        return "Your background grants proficiencies, an origin feat and ability score increases (+2/+1).";
      case "class":
        return "Your class determines what your character can do, in combat and out of it.";
      case "abilities":
        return "These are BASE scores. Background bonuses are added automatically in the next step.";
      case "summary":
        return "After you click the button, the system will open its own dialogs for hit points, proficiencies, equipment and spells.";
      default:
        return "";
    }
  }

  async getCachedEntries(kind) {
    if (!this._entryCache[kind]) this._entryCache[kind] = await getEntries(kind);
    return this._entryCache[kind];
  }

  invalidateCache() {
    this._entryCache = {};
  }

  /* ---------------------------------------------------------------------- */

  _onRender(context, options) {
    const el = this.element;

    el.querySelector("[data-field='name']")?.addEventListener("input", (ev) => {
      this.wizard.name = ev.currentTarget.value;
      const nextBtn = el.querySelector("[data-action='next']");
      if (nextBtn) nextBtn.disabled = !this.wizard.name.trim();
    });

    el.querySelectorAll("[data-pack]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const ids = Array.from(el.querySelectorAll("[data-pack]"))
          .filter((c) => c.checked)
          .map((c) => c.dataset.pack);
        await game.settings.set(MODULE_ID, "enabledPacks", ids);
        this.invalidateCache();
      });
    });

    const search = el.querySelector("[data-search]");
    if (search) {
      search.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLowerCase();
        el.querySelectorAll(".pk5e-option").forEach((node) => {
          node.style.display = !q || node.dataset.search.includes(q) ? "" : "none";
        });
      });
    }

    el.querySelectorAll("[data-method]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        this.wizard.method = ev.currentTarget.dataset.method;
        if (this.wizard.method === "standard") this.wizard.pool = [...STANDARD_ARRAY];
        for (const k of this.abilityKeys) this.wizard.assign[k] = null;
        this.render();
      });
    });

    el.querySelectorAll("select[data-assign]").forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.assign;
        const raw = ev.currentTarget.value;
        this.wizard.assign[key] = raw === "" ? null : Number(raw);
        this.render();
      });
    });

    el.querySelectorAll("input[data-manual]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.manual;
        const raw = Number(ev.currentTarget.value) || 10;
        this.wizard.direct[key] = Math.min(20, Math.max(1, raw));
        this.render();
      });
    });
  }

  /* -------------------------------- ACTIONS ----------------------------- */

  static onGoto(event, target) {
    const idx = Number(target.dataset.index);
    if (idx <= this.wizard.stepIndex) {
      this.wizard.stepIndex = idx;
      this.render();
    }
  }

  static onNext() {
    if (!this.isStepComplete(this.currentStep)) return;
    if (this.wizard.stepIndex < STEPS.length - 1) {
      this.wizard.stepIndex += 1;
      this.render();
    }
  }

  static onBack() {
    if (this.wizard.stepIndex > 0) {
      this.wizard.stepIndex -= 1;
      this.render();
    }
  }

  static async onPick(event, target) {
    const kind = target.dataset.kind;
    const uuid = target.dataset.uuid;
    const entries = await this.getCachedEntries(kind);
    this.wizard[kind] = entries.find((e) => e.uuid === uuid) ?? null;
    this._detail[kind] = await getDescriptionHTML(uuid);
    this.render();
  }

  static onClearPick(event, target) {
    const kind = target.dataset.kind;
    this.wizard[kind] = null;
    this._detail[kind] = null;
    this.render();
  }

  static onAbilityPlus(event, target) {
    const key = target.dataset.ability;
    const max = this.wizard.method === "pointbuy" ? 15 : 20;
    if (this.wizard.direct[key] < max) this.wizard.direct[key] += 1;
    this.render();
  }

  static onAbilityMinus(event, target) {
    const key = target.dataset.ability;
    const min = this.wizard.method === "pointbuy" ? 8 : 1;
    if (this.wizard.direct[key] > min) this.wizard.direct[key] -= 1;
    this.render();
  }

  static async onRollAbilities() {
    const values = [];
    for (let i = 0; i < 6; i++) {
      const roll = await new Roll("4d6dl1").evaluate();
      values.push(roll.total);
    }
    values.sort((a, b) => b - a);
    this.wizard.method = "roll";
    this.wizard.pool = values;
    for (const k of this.abilityKeys) this.wizard.assign[k] = null;
    ui.notifications.info(`Rolled: ${values.join(", ")}`);
    this.render();
  }

  static onResetAbilities() {
    this.wizard.pool = [...STANDARD_ARRAY];
    for (const k of this.abilityKeys) {
      this.wizard.assign[k] = null;
      this.wizard.direct[k] = 8;
    }
    this.render();
  }

  static async onFinish() {
    if (this._busy) return;
    this._busy = true;
    try {
      await this.createCharacter();
    } catch (err) {
      console.error(`${MODULE_ID} | Failed to create character`, err);
      ui.notifications.error(`Character Creator: ${err.message}`);
    } finally {
      this._busy = false;
    }
  }

  /* ------------------------------- CREATION ----------------------------- */

  async createCharacter() {
    const abilities = {};
    for (const [k, v] of Object.entries(this.getAbilities())) abilities[k] = { value: v };

    const actor = await Actor.implementation.create({
      name: this.wizard.name?.trim() || "New Character",
      type: "character",
      system: { abilities },
      prototypeToken: {
        actorLink: true,
        disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        sight: { enabled: true }
      }
    });

    if (!actor) throw new Error("Could not create the actor - check your permissions.");

    this.close();

    // Order matters: the background raises ability scores (2024 rules), so the
    // class - and its Constitution-dependent hit point roll - comes last.
    for (const kind of ["species", "background", "class"]) {
      const entry = this.wizard[kind];
      if (!entry) continue;
      const doc = await fromUuid(entry.uuid);
      if (!doc) {
        ui.notifications.warn(`Could not load: ${entry.name}`);
        continue;
      }
      const data = doc.toObject();
      delete data._id;
      if (kind === "class") foundry.utils.setProperty(data, "system.levels", 1);
      await addItemWithAdvancement(actor, data);
    }

    actor.sheet.render(true);
    ui.notifications.info(`Character "${actor.name}" created.`);
  }
}

/**
 * Adds an item to the actor through the system's Advancement manager and waits
 * until the user closes the resulting dialog.
 */
async function addItemWithAdvancement(actor, itemData) {
  const AdvancementManager =
    foundry.utils.getProperty(globalThis, "dnd5e.applications.advancement.AdvancementManager") ??
    foundry.utils.getProperty(game, "dnd5e.applications.advancement.AdvancementManager");

  if (!AdvancementManager) {
    await actor.createEmbeddedDocuments("Item", [itemData]);
    return;
  }

  let manager = null;
  try {
    manager = AdvancementManager.forNewItem(actor, itemData);
  } catch (err) {
    console.warn(`${MODULE_ID} | Advancement unavailable for ${itemData.name}`, err);
  }

  if (!manager || !manager.steps?.length) {
    await actor.createEmbeddedDocuments("Item", [itemData]);
    return;
  }

  await new Promise((resolve) => {
    const originalClose = manager.close.bind(manager);
    manager.close = async (...args) => {
      try {
        return await originalClose(...args);
      } finally {
        resolve();
      }
    };
    manager.render(true);
  });
}
