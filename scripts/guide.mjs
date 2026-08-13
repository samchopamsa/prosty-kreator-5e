/**
 * guide.mjs
 * ---------------------------------------------------------------------------
 * Guided character creation that drives the sheet's own buttons.
 *
 * We do not reimplement anything. Each step clicks the real "Add Species",
 * "Add Background" or "Add Class" button on the character sheet, so whatever
 * the system and Plutonium have attached to it runs exactly as it would if the
 * player had clicked it themselves.
 *
 * We never try to detect when someone else's window closes. Those windows sit
 * on top of this panel; the player closes them and comes back. The panel simply
 * watches the actor and reports what has landed on the sheet.
 */

import { MODULE_ID } from "./constants.mjs";
import { CompleteCharacter } from "./complete.mjs";
import { LanguagePicker } from "./languages.mjs";
import { checkCharacter } from "./validate.mjs";
import { postSummary } from "./summary.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wording the GM can override in the module settings. */
const DEFAULT_TEXT = {
  introText:
    "Five steps. Each one opens the same dialog the character sheet uses, so anything you have installed works exactly as usual. Those windows appear on top of this one - close them and come back here.",
  textSpecies: "Determines your speed, size and innate traits.",
  textBackground: "Grants proficiencies, an origin feat and ability score increases.",
  textClass: "What your character can do, in combat and out of it.",
  textAbilities: "Importers skip this, so it is done here at the end.",
  textLanguages: "Common plus two more. Roll for them or pick from the table."
};

/**
 * Plain-language explanations for someone who has never built a character.
 * Written from the rules themselves rather than copied from anywhere.
 */
const IMPORT_FLOW =
  " After you press the button, a small window asks where to take the entry from. " +
  "Choose Use Plutonium, then press Open Importer in the window that follows - " +
  "only then do you see the list to pick from.";

const HELP = {
  name:
    "Just a name for now. You can change it at any time, and nothing else depends on it.",
  species:
    "Your character's ancestry - dwarf, elf, human and so on. It sets size and walking speed, and usually adds something innate: darkvision, a resistance, a small once-per-day ability. Under the 2024 rules your species does NOT change your ability scores; that comes from your background." + IMPORT_FLOW,
  background:
    "What your character did before adventuring: soldier, sage, criminal. It grants two skill proficiencies, a tool, a starting feat, and the ability score increases - one ability by 2 and another by 1, or three abilities by 1 each. Pick one whose skills suit the character you imagine." + IMPORT_FLOW,
  class:
    "Your role in the party and the biggest single decision here. It decides how tough you are, what you are trained with, and what you can do in a fight. Fighter and Barbarian are the most forgiving if this is your first character; Wizard and Druid have the most to keep track of." + IMPORT_FLOW,
  abilities:
    "Six numbers describing raw talent. Strength for hitting and lifting, Dexterity for aim and reflexes, Constitution for stamina and hit points, Intelligence for knowledge, Wisdom for perception and willpower, Charisma for force of personality. What matters in play is the modifier next to each score: 10 gives +0, and every two points above or below shifts it by one. Put your highest number in whatever your class uses most.",
  languages:
    "Everyone speaks Common. Your character knows two more, which you can roll for or choose. Languages rarely decide a fight, but they open doors when the party meets someone who does not speak Common."
};

function text(key) {
  const custom = game.settings.get(MODULE_ID, key);
  return (typeof custom === "string" && custom.trim()) || DEFAULT_TEXT[key];
}

/** What each step adds, and how to find its button and its item. */
const STEP_CONFIG = {
  species: {
    itemTypes: ["race", "species"],
    buttonTypes: ["race", "species"],
    labels: ["add species", "add race"]
  },
  background: {
    itemTypes: ["background"],
    buttonTypes: ["background"],
    labels: ["add background"]
  },
  class: {
    itemTypes: ["class"],
    buttonTypes: ["class"],
    labels: ["add class"]
  }
};

/**
 * Deletes an item the way the character sheet does.
 *
 * Class, species and background advancements write proficiencies, features and
 * hit points directly onto the actor. Deleting the item on its own leaves all of
 * that behind, so we hand it to the system's Advancement manager, which knows
 * how to unwind those changes.
 */
async function deleteWithAdvancement(actor, item) {
  const AdvancementManager =
    foundry.utils.getProperty(globalThis, "dnd5e.applications.advancement.AdvancementManager") ??
    foundry.utils.getProperty(game, "dnd5e.applications.advancement.AdvancementManager");

  if (AdvancementManager?.forDeletedItem) {
    let manager = null;
    try {
      manager = AdvancementManager.forDeletedItem(actor, item.id);
    } catch (err) {
      console.warn(`${MODULE_ID} | Advancement reversal unavailable for ${item.name}`, err);
    }

    if (manager?.steps?.length) {
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
      return;
    }
  }

  await item.delete();
}

/**
 * Waits for a button carrying one of the given labels to appear anywhere on the
 * page, then hands it back. Used to walk the player past dialogs belonging to
 * other packages, whose internals we deliberately do not depend on - we only
 * recognise the wording a person would read.
 */
function waitForButton(labels, timeout = 5000) {
  const wanted = labels.map((l) => l.toLowerCase());
  return new Promise((resolve) => {
    const deadline = Date.now() + timeout;

    const find = () => {
      const nodes = document.querySelectorAll("button, a.button, .dialog-button");
      for (const node of nodes) {
        if (node.disabled || node.closest("#pk5e-guide")) continue;
        const label = (node.textContent ?? "").trim().toLowerCase();
        if (label && wanted.some((w) => label === w || label.includes(w))) return node;
      }
      return null;
    };

    const tick = () => {
      const hit = find();
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 120);
    };
    tick();
  });
}

/**
 * Optionally clicks through the "Use Plutonium / Use Compendium Browser" choice
 * and the importer's own "Open Importer" button, so the player lands straight
 * on the list of options. Off by default: it takes a real choice away, and it
 * leans on the wording of another package.
 */
async function autoAdvance() {
  const mode = game.settings.get(MODULE_ID, "autoAdvance");
  if (!mode || mode === "off") return;

  const label = mode === "plutonium" ? "use plutonium" : "use compendium browser";
  const chooser = await waitForButton([label], 4000);
  if (!chooser) return;
  chooser.click();

  if (mode !== "plutonium") return;

  // Plutonium then shows its wizard, which needs one more click to open.
  const opener = await waitForButton(["open importer"], 5000);
  opener?.click();
}

/** Confirmation dialog, tolerant of the API differing between versions. */
async function confirmRemoval(message) {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    try {
      return await DialogV2.confirm({
        window: { title: "Remove" },
        content: `<p>${message}</p>`,
        modal: true
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | DialogV2 unavailable, falling back`, err);
    }
  }
  return window.confirm(message);
}

/**
 * Finds an "Add X" button on the sheet.
 *
 * The sheet marks these with data-item-type ("class", "race", "background").
 * Matching on that is language independent; the label match below is only a
 * fallback for sheet versions that omit the attribute.
 */
function findAddButton(root, types, labels) {
  if (!root) return null;
  const candidates = Array.from(root.querySelectorAll("[data-action='findItem']"));

  const byType = candidates.find((b) => {
    const value = String(b.dataset.itemType ?? b.dataset.type ?? "").toLowerCase();
    return value && types.includes(value);
  });
  if (byType) return byType;

  return candidates.find((b) => {
    const text = `${b.textContent ?? ""} ${b.dataset.tooltip ?? ""}`.trim().toLowerCase();
    return labels.some((label) => text.includes(label));
  });
}

/** Puts the sheet into edit mode, where the "Add X" buttons exist at all. */
async function ensureEditMode(actor) {
  const sheet = actor.sheet;
  const MODES = sheet.constructor?.MODES;
  if (MODES?.EDIT === undefined || sheet._mode === MODES.EDIT) return;

  const toggle = sheet.element?.querySelector("[data-action='changeMode']");
  if (!toggle) return;
  toggle.click();
  await wait(400);
}

/**
 * Clicks the sheet's own button. Opens the sheet if needed and flips it into
 * edit mode when the button is not visible in play mode.
 */
async function pressSheetButton(actor, types, labels) {
  const sheet = actor.sheet;
  if (!sheet.rendered) {
    await sheet.render(true);
    await wait(300);
  }

  await ensureEditMode(actor);

  let button = findAddButton(actor.sheet.element, types, labels);
  if (!button) {
    // The sheet may still be redrawing after the mode switch.
    await wait(400);
    button = findAddButton(actor.sheet.element, types, labels);
  }

  if (!button) {
    ui.notifications.warn(
      "That button is not on the sheet right now. Put the sheet into edit mode and try again."
    );
    return false;
  }

  button.click();
  autoAdvance();
  return true;
}

/**
 * Which creation steps are still outstanding on an actor. Used to decide
 * whether to offer "Resume creation" at all.
 */
export function missingSteps(actor) {
  if (!actor || actor.type !== "character") return [];
  const missing = [];
  for (const [step, config] of Object.entries(STEP_CONFIG)) {
    const has = actor.items.some((i) => config.itemTypes.includes(i.type));
    if (!has) missing.push(step);
  }
  if (!actor.getFlag(MODULE_ID, "abilities")) missing.push("abilities");
  if (!actor.getFlag(MODULE_ID, "languages")) missing.push("languages");
  return missing;
}

export function isIncomplete(actor) {
  return missingSteps(actor).length > 0;
}

export class CreationGuide extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId ?? null;
    this._hooks = [];

    // Fill the available height rather than opening as a narrow strip over the
    // sheet, which was hard to read.
    const available = (globalThis.innerHeight ?? 900) - 80;
    this.options.position = {
      ...this.options.position,
      width: Math.min(620, (globalThis.innerWidth ?? 1200) - 60),
      height: Math.max(520, Math.min(880, available))
    };
    /** Per-step override of whether the explanation is expanded. */
    this._help = {};
  }

  static DEFAULT_OPTIONS = {
    id: "pk5e-guide",
    tag: "div",
    classes: ["pk5e-creator", "pk5e-guide"],
    window: {
      title: "New Character",
      icon: "fa-solid fa-hat-wizard",
      resizable: true
    },
    position: { width: 380, height: 560 },
    actions: {
      addStep: CreationGuide.onAddStep,
      replaceStep: CreationGuide.onReplaceStep,
      removeStep: CreationGuide.onRemoveStep,
      openSheet: CreationGuide.onOpenSheet,
      finalise: CreationGuide.onFinalise,
      languages: CreationGuide.onLanguages,
      postSummary: CreationGuide.onPostSummary,
      recheck: CreationGuide.onRecheck
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/guide.hbs` }
  };

  get actor() {
    return this.actorId ? game.actors.get(this.actorId) : null;
  }

  /**
   * Opens the guide for an existing character. Each actor gets its own window
   * id, so guides for two characters do not fight over the same application.
   */
  static open(actorId) {
    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.warn("That character no longer exists.");
      return null;
    }
    const existing = foundry.applications.instances?.get(`pk5e-guide-${actorId}`);
    if (existing) {
      existing.bringToFront?.();
      existing.render(true);
      return existing;
    }
    const guide = new CreationGuide({ actorId, id: `pk5e-guide-${actorId}` });
    guide.render(true);
    return guide;
  }

  /** Creates a blank character and opens the guide beside its sheet. */
  static async start() {
    const allowed = game.user.isGM
      ? true
      : typeof game.user.hasPermission === "function"
        ? game.user.hasPermission("ACTOR_CREATE")
        : game.user.can?.("ACTOR_CREATE");

    if (!allowed) {
      ui.notifications.error(
        "You cannot create characters yet. Ask your GM to enable 'Create New Actors' " +
          "for your role under Settings, Configure Permissions.",
        { permanent: true }
      );
      return null;
    }
    const actor = await Actor.implementation.create({
      name: "New Character",
      type: "character",
      prototypeToken: {
        actorLink: true,
        disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        sight: { enabled: true }
      }
    });
    if (!actor) return null;
    await actor.sheet.render(true);
    return CreationGuide.open(actor.id);
  }

  async _prepareContext() {
    const actor = this.actor;
    if (!actor) return { missing: true };

    const species = actor.items.find((i) => i.type === "race" || i.type === "species");
    const background = actor.items.find((i) => i.type === "background");
    const cls = actor.items.find((i) => i.type === "class");
    const abilitiesDone = !!actor.getFlag(MODULE_ID, "abilities");

    const known = actor.system?.traits?.languages?.value;
    const languageCount = known ? Array.from(known).length : 0;
    const languageSummary = languageCount
      ? `${languageCount} language${languageCount === 1 ? "" : "s"}`
      : "";

    const steps = [
      {
        key: "species",
        number: 2,
        label: "Species",
        icon: "fa-dna",
        help: HELP.species,
        removable: true,
        done: !!species,
        result: species?.name ?? "",
        img: species?.img ?? "",
        blurb: text("textSpecies")
      },
      {
        key: "background",
        number: 3,
        label: "Background",
        icon: "fa-scroll",
        help: HELP.background,
        removable: true,
        done: !!background,
        result: background?.name ?? "",
        img: background?.img ?? "",
        blurb: text("textBackground")
      },
      {
        key: "class",
        number: 4,
        label: "Class",
        icon: "fa-shield-halved",
        help: HELP.class,
        removable: true,
        done: !!cls,
        result: cls ? `${cls.name} (level ${cls.system?.levels ?? 1})` : "",
        img: cls?.img ?? "",
        blurb: text("textClass")
      },
      {
        key: "abilities",
        number: 5,
        label: "Ability scores",
        icon: "fa-dice-d20",
        help: HELP.abilities,
        removable: false,
        done: abilitiesDone,
        result: abilitiesDone
          ? Object.entries(actor.system?.abilities ?? {})
              .map(([, v]) => v.value)
              .join(" / ")
          : "",
        img: "",
        blurb: text("textAbilities")
      },
      {
        key: "languages",
        number: 6,
        label: "Languages",
        icon: "fa-comments",
        help: HELP.languages,
        removable: false,
        action: "languages",
        done: !!actor.getFlag(MODULE_ID, "languages"),
        result: languageSummary,
        img: "",
        blurb: text("textLanguages")
      }
    ];

    const showHelp = game.settings.get(MODULE_ID, "showStepHelp");
    // Explanations start open on a brand new character and stay closed once the
    // player has clearly done this before.
    const helpDefault = steps.filter((step) => step.done).length === 0;
    for (const step of steps) {
      step.showHelp = showHelp && !!step.help;
      step.helpOpen = this._help[step.key] ?? helpDefault;
    }

    const report = checkCharacter(actor);
    const ownership = actor.ownership ?? {};

    return {
      actorName: actor.name,
      actorImg: actor.img ?? "",
      nameHelp: showHelp ? HELP.name : "",
      nameHelpOpen: this._help.name ?? helpDefault,
      introText: text("introText"),
      isGM: game.user.isGM,
      report,
      failures: report.checks.filter((c) => !c.ok),
      ready: report.ready,
      players: game.users
        .filter((u) => !u.isGM)
        .map((u) => ({
          id: u.id,
          name: u.name,
          selected: ownership[u.id] === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      folders: game.folders
        .filter((f) => f.type === "Actor")
        .map((f) => ({ id: f.id, name: f.name, selected: f.id === actor.folder?.id })),
      steps,
      allDone: steps.every((s) => s.done),
      progress: `${steps.filter((s) => s.done).length} of ${steps.length}`
    };
  }

  _onRender() {
    const input = this.element.querySelector("[data-field='name']");
    if (input) {
      const save = async (ev) => {
        const name = ev.currentTarget.value.trim();
        if (name && this.actor && name !== this.actor.name) {
          await this.actor.update({ name });
        }
      };
      input.addEventListener("change", save);
      // Saving on Enter too, so the name sticks even if the field keeps focus.
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          save(ev);
        }
      });
    }

    this.element.querySelector("select[data-owner]")?.addEventListener("change", async (ev) => {
      const chosen = ev.currentTarget.value;
      const { OWNER, NONE } = CONST.DOCUMENT_OWNERSHIP_LEVELS;

      // One character, one player. Every other player is reset, so reassigning
      // does not silently leave the previous owner with access.
      const update = {};
      for (const user of game.users.filter((u) => !u.isGM)) {
        update[`ownership.${user.id}`] = user.id === chosen ? OWNER : NONE;
      }

      try {
        await this.actor?.update(update);
      } catch (err) {
        console.error(`${MODULE_ID} | Could not change ownership`, err);
        ui.notifications.error(`Could not change ownership: ${err.message}`);
      }
    });

    this.element.querySelector("select[data-folder]")?.addEventListener("change", async (ev) => {
      const value = ev.currentTarget.value || null;
      try {
        await this.actor?.update({ folder: value });
      } catch (err) {
        console.error(`${MODULE_ID} | Could not move the character`, err);
        ui.notifications.error(`Could not move the character: ${err.message}`);
      }
    });

    this.element.querySelectorAll("details[data-help]").forEach((node) => {
      node.addEventListener("toggle", () => {
        this._help[node.dataset.help] = node.open;
      });
    });

    if (!this._hooks.length) this.registerWatchers();
  }

  /**
   * Redraw whenever something lands on (or leaves) the actor.
   *
   * Renaming is handled separately and deliberately does NOT redraw. Clicking a
   * step button first blurs the name field, which fires `change` and updates the
   * actor; redrawing at that moment would destroy the very button being clicked
   * before the click completed, so the first click appeared to do nothing.
   */
  registerWatchers() {
    const onItem = (doc) => {
      if (doc?.parent?.id === this.actorId) this.render();
    };
    for (const hook of ["createItem", "deleteItem", "updateItem"]) {
      this._hooks.push([hook, Hooks.on(hook, onItem)]);
    }

    const onActor = (doc, changed = {}) => {
      if (doc?.id !== this.actorId) return;

      const keys = Object.keys(changed).filter((k) => k !== "_id" && k !== "_stats");
      if (keys.length && keys.every((k) => k === "name")) {
        // Keep the field in sync without touching the DOM the user is clicking.
        const field = this.element?.querySelector("[data-field='name']");
        if (field && document.activeElement !== field) field.value = doc.name;
        return;
      }
      this.render();
    };
    this._hooks.push(["updateActor", Hooks.on("updateActor", onActor)]);
  }

  async close(options) {
    for (const [hook, id] of this._hooks) Hooks.off(hook, id);
    this._hooks = [];

    // Closing the panel counts as "I have seen this". It will not open by
    // itself again; the sheet button remains for anyone who wants it back.
    try {
      if (this.actor?.isOwner && !this.actor.getFlag(MODULE_ID, "guideDismissed")) {
        await this.actor.setFlag(MODULE_ID, "guideDismissed", true);
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not record the panel being closed`, err);
    }

    return super.close(options);
  }

  /** Items on the actor belonging to a given step. */
  itemsFor(step) {
    const config = STEP_CONFIG[step];
    if (!config || !this.actor) return [];
    return this.actor.items.filter((i) => config.itemTypes.includes(i.type));
  }

  async addFor(step) {
    const config = STEP_CONFIG[step];
    if (!config || !this.actor) return false;
    return pressSheetButton(this.actor, config.buttonTypes, config.labels);
  }

  /**
   * Removes what the step added. Necessary because the sheet's own "Add Class"
   * button always ADDS - clicking it with a class already present starts a
   * multiclass rather than replacing anything.
   */
  async removeFor(step, { confirm = true } = {}) {
    const items = this.itemsFor(step);
    if (!items.length) return true;

    if (confirm) {
      const names = items.map((i) => i.name).join(", ");
      const ok = await confirmRemoval(
        `Remove ${names}? Features granted by it are removed as well.`
      );
      if (!ok) return false;
    }

    try {
      // One at a time: each may open its own advancement reversal window.
      for (const item of items) {
        if (!this.actor.items.get(item.id)) continue;
        await deleteWithAdvancement(this.actor, item);
      }
      return true;
    } catch (err) {
      console.error(`${MODULE_ID} | Could not remove the ${step}`, err);
      ui.notifications.error(`Could not remove the ${step}: ${err.message}`);
      return false;
    }
  }

  static async onAddStep(event, target) {
    await this.addFor(target.dataset.step);
  }

  static async onReplaceStep(event, target) {
    const step = target.dataset.step;
    const removed = await this.removeFor(step);
    if (!removed) return;
    await wait(200);
    await this.addFor(step);
  }

  static async onRemoveStep(event, target) {
    await this.removeFor(target.dataset.step);
  }

  static async onPostSummary() {
    if (!this.actor) return;
    const message = await postSummary(this.actor);
    if (message) ui.notifications.info("Summary posted to chat.");
  }

  static onRecheck() {
    this.render();
  }

  static onOpenSheet() {
    this.actor?.sheet.render(true);
  }

  static onLanguages() {
    if (!this.actor) {
      ui.notifications.warn("That character no longer exists.");
      return;
    }
    try {
      new LanguagePicker({ actorId: this.actorId, id: `pk5e-languages-${this.actorId}` }).render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not open the language picker`, err);
      ui.notifications.error(`Could not open the language picker: ${err.message}`);
    }
  }

  static onFinalise() {
    if (!this.actor) {
      ui.notifications.warn("That character no longer exists.");
      return;
    }
    try {
      new CompleteCharacter({ actorId: this.actorId }).render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not open the finaliser`, err);
      ui.notifications.error(`Could not open the finaliser: ${err.message}`);
    }
  }
}
