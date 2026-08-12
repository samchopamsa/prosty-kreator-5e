/**
 * creator.mjs
 * ---------------------------------------------------------------------------
 * Okno kreatora postaci. Napisane na ApplicationV2 (Foundry v13+).
 *
 * Kroki: Zrodla -> Gatunek -> Pochodzenie -> Klasa -> Atrybuty -> Podsumowanie
 *
 * Po kliknieciu "Stworz postac" modul tworzy Aktora, ustawia bazowe atrybuty,
 * a nastepnie dodaje gatunek, pochodzenie i klase przez systemowy mechanizm
 * Advancement - to on wyswietla okna z wyborem HP, biegłosci, ekwipunku
 * startowego i zaklec. Nie duplikujemy tej logiki.
 */

import { MODULE_ID, getEntries, getPackChoices, getDescriptionHTML } from "./sources.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Kolejnosc i etykiety krokow. */
const STEPS = [
  { key: "intro", label: "Start" },
  { key: "species", label: "Gatunek" },
  { key: "background", label: "Pochodzenie" },
  { key: "class", label: "Klasa" },
  { key: "abilities", label: "Atrybuty" },
  { key: "summary", label: "Podsumowanie" }
];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const POINT_BUY_TOTAL = 27;

export class CharacterCreator extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);

    this.state = {
      stepIndex: 0,
      name: "",
      species: null,
      background: null,
      class: null,
      method: game.settings.get(MODULE_ID, "abilityMethod") ?? "standard",
      /** pula wartosci do przypisania (standard array / rzut) */
      pool: [...STANDARD_ARRAY],
      /** ktora wartosc z puli trafia do ktorego atrybutu: {str: 0, dex: 3, ...} */
      assign: {},
      /** wartosci dla trybu point-buy i recznego */
      direct: {}
    };

    for (const key of this.abilityKeys) {
      this.state.assign[key] = null;
      this.state.direct[key] = 8;
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
      title: "Kreator Postaci",
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

  /** Klucze atrybutow w kolejnosci systemowej (str, dex, con, int, wis, cha). */
  get abilityKeys() {
    return Object.keys(CONFIG.DND5E?.abilities ?? {
      str: {}, dex: {}, con: {}, int: {}, wis: {}, cha: {}
    });
  }

  get step() {
    return STEPS[this.state.stepIndex].key;
  }

  /** Czy krok jest wypelniony na tyle, by isc dalej. */
  isStepComplete(key) {
    switch (key) {
      case "intro":
        return !!this.state.name?.trim();
      case "species":
        return !!this.state.species;
      case "background":
        return !!this.state.background;
      case "class":
        return !!this.state.class;
      case "abilities":
        return this.abilitiesValid();
      default:
        return true;
    }
  }

  abilitiesValid() {
    const m = this.state.method;
    if (m === "standard" || m === "roll") {
      return this.abilityKeys.every((k) => this.state.assign[k] !== null);
    }
    if (m === "pointbuy") {
      return this.pointsSpent() <= POINT_BUY_TOTAL;
    }
    return this.abilityKeys.every((k) => {
      const v = Number(this.state.direct[k]);
      return Number.isFinite(v) && v >= 1 && v <= 20;
    });
  }

  pointsSpent() {
    return this.abilityKeys.reduce(
      (sum, k) => sum + (POINT_BUY_COST[this.state.direct[k]] ?? 0),
      0
    );
  }

  /** Ostateczne wartosci atrybutow (bez bonusow z pochodzenia - te doda Advancement). */
  getAbilities() {
    const out = {};
    const m = this.state.method;
    for (const k of this.abilityKeys) {
      if (m === "standard" || m === "roll") {
        const idx = this.state.assign[k];
        out[k] = idx === null ? 10 : this.state.pool[idx];
      } else {
        out[k] = Number(this.state.direct[k]) || 10;
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------------- */

  async _prepareContext(options) {
    const step = this.step;
    const isGM = game.user.isGM;

    const context = {
      state: this.state,
      isGM,
      step,
      isIntro: step === "intro",
      isSpecies: step === "species",
      isBackground: step === "background",
      isClass: step === "class",
      isAbilities: step === "abilities",
      isSummary: step === "summary",
      isPickStep: ["species", "background", "class"].includes(step),
      busy: this._busy,
      steps: STEPS.map((s, i) => ({
        index: i,
        number: i + 1,
        label: s.label,
        active: i === this.state.stepIndex,
        done: i < this.state.stepIndex && this.isStepComplete(s.key)
      })),
      canBack: this.state.stepIndex > 0,
      canNext: this.isStepComplete(step),
      hint: this.stepHint(step)
    };

    if (step === "intro") {
      context.packs = getPackChoices();
    }

    if (context.isPickStep) {
      context.kind = step;
      context.kindLabel = STEPS[this.state.stepIndex].label;
      const entries = await this.getCachedEntries(step);
      const selectedUuid = this.state[step]?.uuid ?? null;
      context.list = entries.map((e) => ({ ...e, selected: e.uuid === selectedUuid }));
      context.selected = this.state[step];
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
    const m = this.state.method;
    const usedIndexes = new Set(
      Object.values(this.state.assign).filter((v) => v !== null)
    );

    const rows = this.abilityKeys.map((key) => {
      const cfg = CONFIG.DND5E?.abilities?.[key] ?? {};
      const row = {
        key,
        label: cfg.label ?? key.toUpperCase(),
        abbr: (cfg.abbreviation ?? key).toUpperCase()
      };

      if (m === "standard" || m === "roll") {
        row.assigned = this.state.assign[key];
        row.value = row.assigned === null ? null : this.state.pool[row.assigned];
        row.options = this.state.pool.map((v, i) => ({
          index: i,
          value: v,
          selected: this.state.assign[key] === i,
          disabled: usedIndexes.has(i) && this.state.assign[key] !== i
        }));
      } else {
        row.value = Number(this.state.direct[key]);
        row.cost = POINT_BUY_COST[row.value] ?? null;
        row.minusDisabled = m === "pointbuy" ? row.value <= 8 : row.value <= 1;
        row.plusDisabled =
          m === "pointbuy"
            ? row.value >= 15 ||
              this.pointsSpent() - (POINT_BUY_COST[row.value] ?? 0) +
                (POINT_BUY_COST[row.value + 1] ?? 99) > POINT_BUY_TOTAL
            : row.value >= 20;
      }

      row.mod = row.value === null || row.value === undefined
        ? null
        : Math.floor((row.value - 10) / 2);
      row.modLabel = row.mod === null ? "—" : (row.mod >= 0 ? `+${row.mod}` : `${row.mod}`);
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
      pointsLeft: POINT_BUY_TOTAL - this.pointsSpent(),
      rolled: m === "roll" && this.state.pool.length === 6
    };
  }

  stepHint(step) {
    switch (step) {
      case "intro":
        return "Wpisz imie postaci. Ponizej mozesz sprawdzic, z ktorych kompendiow kreator bierze dane.";
      case "species":
        return "Gatunek okresla szybkosc, rozmiar i cechy wrodzone.";
      case "background":
        return "Pochodzenie daje biegłosci, atut startowy i podwyzszenia atrybutow (+2/+1).";
      case "class":
        return "Klasa okresla, co Twoja postac potrafi w walce i poza nia.";
      case "abilities":
        return "To sa wartosci BAZOWE. Bonusy z pochodzenia system doda automatycznie w nastepnym kroku.";
      case "summary":
        return "Po kliknieciu przycisku system otworzy okienka z wyborem HP, biegłosci, ekwipunku i zaklec.";
      default:
        return "";
    }
  }

  async getCachedEntries(kind) {
    if (!this._entryCache[kind]) this._entryCache[kind] = await getEntries(kind);
    return this._entryCache[kind];
  }

  /** Czysci cache list po zmianie wlaczonych zrodel. */
  invalidateCache() {
    this._entryCache = {};
  }

  /* ---------------------------------------------------------------------- */

  _onRender(context, options) {
    const el = this.element;

    // Pole z imieniem postaci
    el.querySelector("[data-field='name']")?.addEventListener("input", (ev) => {
      this.state.name = ev.currentTarget.value;
      const nextBtn = el.querySelector("[data-action='next']");
      if (nextBtn) nextBtn.disabled = !this.state.name.trim();
    });

    // Checkboxy zrodel (tylko GM)
    el.querySelectorAll("[data-pack]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const ids = Array.from(el.querySelectorAll("[data-pack]"))
          .filter((c) => c.checked)
          .map((c) => c.dataset.pack);
        await game.settings.set(MODULE_ID, "enabledPacks", ids);
        this.invalidateCache();
      });
    });

    // Wyszukiwarka na listach
    const search = el.querySelector("[data-search]");
    if (search) {
      search.addEventListener("input", (ev) => {
        const q = ev.currentTarget.value.trim().toLowerCase();
        el.querySelectorAll(".pk5e-option").forEach((node) => {
          node.style.display = !q || node.dataset.search.includes(q) ? "" : "none";
        });
      });
    }

    // Wybor metody atrybutow
    el.querySelectorAll("[data-method]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        this.state.method = ev.currentTarget.dataset.method;
        if (this.state.method === "standard") this.state.pool = [...STANDARD_ARRAY];
        for (const k of this.abilityKeys) this.state.assign[k] = null;
        this.render();
      });
    });

    // Przypisywanie wartosci z puli
    el.querySelectorAll("select[data-assign]").forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.assign;
        const raw = ev.currentTarget.value;
        this.state.assign[key] = raw === "" ? null : Number(raw);
        this.render();
      });
    });

    // Reczne wpisywanie wartosci
    el.querySelectorAll("input[data-manual]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.manual;
        this.state.direct[key] = Math.clamp
          ? Math.clamp(Number(ev.currentTarget.value) || 10, 1, 20)
          : Math.min(20, Math.max(1, Number(ev.currentTarget.value) || 10));
        this.render();
      });
    });
  }

  /* ------------------------------- AKCJE -------------------------------- */

  static onGoto(event, target) {
    const idx = Number(target.dataset.index);
    // Wolno cofac sie zawsze; do przodu tylko przez "Dalej".
    if (idx <= this.state.stepIndex) {
      this.state.stepIndex = idx;
      this.render();
    }
  }

  static onNext() {
    if (!this.isStepComplete(this.step)) return;
    if (this.state.stepIndex < STEPS.length - 1) {
      this.state.stepIndex += 1;
      this.render();
    }
  }

  static onBack() {
    if (this.state.stepIndex > 0) {
      this.state.stepIndex -= 1;
      this.render();
    }
  }

  static async onPick(event, target) {
    const kind = target.dataset.kind;
    const uuid = target.dataset.uuid;
    const entries = await this.getCachedEntries(kind);
    this.state[kind] = entries.find((e) => e.uuid === uuid) ?? null;
    this._detail[kind] = await getDescriptionHTML(uuid);
    this.render();
  }

  static onClearPick(event, target) {
    const kind = target.dataset.kind;
    this.state[kind] = null;
    this._detail[kind] = null;
    this.render();
  }

  static onAbilityPlus(event, target) {
    const key = target.dataset.ability;
    const max = this.state.method === "pointbuy" ? 15 : 20;
    if (this.state.direct[key] < max) this.state.direct[key] += 1;
    this.render();
  }

  static onAbilityMinus(event, target) {
    const key = target.dataset.ability;
    const min = this.state.method === "pointbuy" ? 8 : 1;
    if (this.state.direct[key] > min) this.state.direct[key] -= 1;
    this.render();
  }

  static async onRollAbilities() {
    const values = [];
    for (let i = 0; i < 6; i++) {
      const roll = await new Roll("4d6dl1").evaluate();
      values.push(roll.total);
    }
    values.sort((a, b) => b - a);
    this.state.method = "roll";
    this.state.pool = values;
    for (const k of this.abilityKeys) this.state.assign[k] = null;
    ui.notifications.info(`Wyrzucono: ${values.join(", ")}`);
    this.render();
  }

  static onResetAbilities() {
    this.state.pool = [...STANDARD_ARRAY];
    for (const k of this.abilityKeys) {
      this.state.assign[k] = null;
      this.state.direct[k] = 8;
    }
    this.render();
  }

  static async onFinish() {
    if (this._busy) return;
    this._busy = true;
    try {
      await this.createCharacter();
    } catch (err) {
      console.error(`${MODULE_ID} | Blad podczas tworzenia postaci`, err);
      ui.notifications.error(`Kreator: ${err.message}`);
    } finally {
      this._busy = false;
    }
  }

  /* ---------------------------- TWORZENIE ------------------------------- */

  async createCharacter() {
    const abilities = {};
    const values = this.getAbilities();
    for (const [k, v] of Object.entries(values)) abilities[k] = { value: v };

    const actor = await Actor.implementation.create({
      name: this.state.name?.trim() || "Nowa Postac",
      type: "character",
      system: { abilities },
      prototypeToken: {
        actorLink: true,
        disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        sight: { enabled: true }
      }
    });

    if (!actor) throw new Error("Nie udalo sie utworzyc aktora (sprawdz uprawnienia).");

    this.close();

    // Kolejnosc ma znaczenie: pochodzenie podnosi atrybuty (2024), wiec klasa
    // (i rzut na HP zalezny od KON) idzie na koncu.
    for (const kind of ["species", "background", "class"]) {
      const entry = this.state[kind];
      if (!entry) continue;
      const doc = await fromUuid(entry.uuid);
      if (!doc) {
        ui.notifications.warn(`Nie znaleziono wpisu: ${entry.name}`);
        continue;
      }
      const data = doc.toObject();
      delete data._id;
      if (kind === "class") foundry.utils.setProperty(data, "system.levels", 1);
      await addItemWithAdvancement(actor, data);
    }

    actor.sheet.render(true);
    ui.notifications.info(`Postac "${actor.name}" zostala utworzona.`);
  }
}

/**
 * Dodaje przedmiot do aktora przez systemowy mechanizm Advancement
 * i czeka, az uzytkownik zamknie okno wyborow.
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
    console.warn(`${MODULE_ID} | Advancement niedostepny dla ${itemData.name}`, err);
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
