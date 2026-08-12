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

import { MODULE_ID } from "./sources.mjs";
import { CompleteCharacter } from "./complete.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Finds an "Add X" button on the sheet, by data-type first, then by label. */
function findAddButton(root, type, labels) {
  if (!root) return null;
  const candidates = Array.from(root.querySelectorAll("[data-action='findItem']"));
  const byType = candidates.find(
    (b) => String(b.dataset.type ?? "").toLowerCase() === type
  );
  if (byType) return byType;
  return candidates.find((b) => {
    const text = `${b.textContent ?? ""} ${b.dataset.tooltip ?? ""}`.trim().toLowerCase();
    return labels.some((label) => text.includes(label));
  });
}

/**
 * Clicks the sheet's own button. Opens the sheet if needed and flips it into
 * edit mode when the button is not visible in play mode.
 */
async function pressSheetButton(actor, type, labels) {
  const sheet = actor.sheet;
  if (!sheet.rendered) {
    await sheet.render(true);
    await wait(250);
  }

  let button = findAddButton(sheet.element, type, labels);

  if (!button) {
    const modeToggle = sheet.element?.querySelector("[data-action='changeMode']");
    if (modeToggle) {
      modeToggle.click();
      await wait(350);
      button = findAddButton(actor.sheet.element, type, labels);
    }
  }

  if (!button) {
    ui.notifications.warn(
      "Could not find that button on the sheet. Switch the sheet to edit mode and try again."
    );
    return false;
  }

  button.click();
  return true;
}

export class CreationGuide extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId ?? null;
    this._hooks = [];
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
      addSpecies: CreationGuide.onAddSpecies,
      addBackground: CreationGuide.onAddBackground,
      addClass: CreationGuide.onAddClass,
      openSheet: CreationGuide.onOpenSheet,
      finalise: CreationGuide.onFinalise
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/guide.hbs` }
  };

  get actor() {
    return this.actorId ? game.actors.get(this.actorId) : null;
  }

  /** Creates a blank character and opens the guide beside its sheet. */
  static async start() {
    if (!game.user.can("ACTOR_CREATE")) {
      ui.notifications.error("You do not have permission to create actors.");
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
    const guide = new CreationGuide({ actorId: actor.id });
    guide.render(true);
    return guide;
  }

  async _prepareContext() {
    const actor = this.actor;
    if (!actor) return { missing: true };

    const species = actor.items.find((i) => i.type === "race" || i.type === "species");
    const background = actor.items.find((i) => i.type === "background");
    const cls = actor.items.find((i) => i.type === "class");
    const abilitiesDone = !!actor.getFlag(MODULE_ID, "abilities");

    const steps = [
      {
        key: "species",
        number: 2,
        label: "Species",
        action: "addSpecies",
        done: !!species,
        result: species?.name ?? "",
        blurb: "Determines your speed, size and innate traits."
      },
      {
        key: "background",
        number: 3,
        label: "Background",
        action: "addBackground",
        done: !!background,
        result: background?.name ?? "",
        blurb: "Grants proficiencies, an origin feat and ability score increases."
      },
      {
        key: "class",
        number: 4,
        label: "Class",
        action: "addClass",
        done: !!cls,
        result: cls ? `${cls.name} (level ${cls.system?.levels ?? 1})` : "",
        blurb: "What your character can do, in combat and out of it."
      },
      {
        key: "abilities",
        number: 5,
        label: "Ability scores and languages",
        action: "finalise",
        done: abilitiesDone,
        result: abilitiesDone
          ? Object.entries(actor.system?.abilities ?? {})
              .map(([, v]) => v.value)
              .join(" / ")
          : "",
        blurb: "Importers skip this, so it is done here at the end."
      }
    ];

    return {
      actorName: actor.name,
      steps,
      allDone: steps.every((s) => s.done),
      progress: `${steps.filter((s) => s.done).length} of ${steps.length}`
    };
  }

  _onRender() {
    const input = this.element.querySelector("[data-field='name']");
    if (input) {
      input.addEventListener("change", async (ev) => {
        const name = ev.currentTarget.value.trim();
        if (name && this.actor) await this.actor.update({ name });
      });
    }

    if (!this._hooks.length) this.registerWatchers();
  }

  /** Redraw whenever something lands on (or leaves) the actor. */
  registerWatchers() {
    const belongs = (doc) => doc?.parent?.id === this.actorId || doc?.id === this.actorId;
    const refresh = (doc) => {
      if (belongs(doc)) this.render();
    };
    for (const hook of ["createItem", "deleteItem", "updateItem", "updateActor"]) {
      const id = Hooks.on(hook, refresh);
      this._hooks.push([hook, id]);
    }
  }

  async close(options) {
    for (const [hook, id] of this._hooks) Hooks.off(hook, id);
    this._hooks = [];
    return super.close(options);
  }

  static async onAddSpecies() {
    if (this.actor) await pressSheetButton(this.actor, "race", ["add species", "add race"]);
  }

  static async onAddBackground() {
    if (this.actor) await pressSheetButton(this.actor, "background", ["add background"]);
  }

  static async onAddClass() {
    if (this.actor) await pressSheetButton(this.actor, "class", ["add class"]);
  }

  static onOpenSheet() {
    this.actor?.sheet.render(true);
  }

  static onFinalise() {
    if (!this.actor) return;
    new CompleteCharacter({ actorId: this.actorId }).render(true);
  }
}
