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
import { ClassReference } from "./reference.mjs";
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
  textLanguages: "Common plus two more. Roll for them or pick from the table.",
  textPortrait: "Optional. A picture for your character, shown on the sheet and on the token."
};

/**
 * Plain-language explanations for someone who has never built a character.
 * Written from the rules themselves rather than copied from anywhere.
 */
/**
 * The closing sentence of each pick step describes the clicks still ahead. When
 * the module clicks through those dialogs itself, describing them would be
 * describing something the player never sees.
 */
function importFlowNote() {
  const mode = game.settings.get(MODULE_ID, "autoAdvance");

  if (mode === "plutonium") {
    return " After you press the button, the list of options opens by itself.";
  }
  if (mode === "compendium") {
    return " After you press the button, the compendium browser opens by itself.";
  }
  return (
    " After you press the button, a small window asks where to take the entry from. " +
    "Choose Use Plutonium, then press Open Importer in the window that follows - " +
    "only then do you see the list to pick from."
  );
}

const HELP = {
  name:
    "Just a name for now. You can change it at any time, and nothing else depends on it.",
  species:
    "Your character's ancestry - dwarf, elf, human and so on. It sets size and walking speed, and usually adds something innate: darkvision, a resistance, a small once-per-day ability. Under the 2024 rules your species does NOT change your ability scores; that comes from your background.",
  background:
    "What your character did before adventuring: soldier, sage, criminal. It grants two skill proficiencies, a tool, a starting feat, and the ability score increases - one ability by 2 and another by 1, or three abilities by 1 each. Pick one whose skills suit the character you imagine.",
  class:
    "Your role in the party and the biggest single decision here. It decides how tough you are, what you are trained with, and what you can do in a fight. Fighter and Barbarian are the most forgiving if this is your first character; Wizard and Druid have the most to keep track of.",
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
 * Finds the "Keep Window Open" checkbox on the importer screen.
 *
 * Matched by the wording next to it, because we only ever act on things a
 * person could see and click themselves.
 */
function findKeepOpenCheckbox() {
  for (const box of document.querySelectorAll("input[type='checkbox']")) {
    if (box.closest("#pk5e-guide")) continue;
    const row = box.closest("label, tr, div, li");
    const text = (row?.textContent ?? "").trim().toLowerCase();
    if (text.includes("keep window open")) return box;
  }
  return null;
}

/**
 * Optionally clicks through the "Use Plutonium / Use Compendium Browser" choice
 * and the importer's own "Open Importer" button, so the player lands straight
 * on the list of options. Off by default: it takes a real choice away, and it
 * leans on the wording of another package.
 *
 * Note the Keep Window Open step. That checkbox lives ONLY on the screen we are
 * about to click past, so a player who had it ticked would never get another
 * chance to untick it - the two conveniences would combine into a trap. We
 * therefore untick it here, doing exactly what the player would have done, and
 * only if we can actually see it.
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
  if (!opener) return;

  if (game.settings.get(MODULE_ID, "uncheckKeepOpen")) {
    const keepOpen = findKeepOpenCheckbox();
    if (keepOpen?.checked) {
      keepOpen.click();
      console.log(`${MODULE_ID} | Unticked "Keep Window Open" before opening the importer.`);
    }
  }

  opener.click();
}

/**
 * Plutonium reports progress in its own window and finishes with an "Import
 * Complete" dialog the player closes. Features keep arriving until then, and
 * further choices can still pop up, so a step is not really finished the moment
 * the first item lands on the sheet.
 *
 * We watch for that window and hold the step in an "importing" state until it
 * goes away. Recognised by its title, so if Plutonium renames it we simply stop
 * showing the notice; nothing breaks.
 */
const IMPORT_TITLES = ["import complete", "importing", "import wizard"];

function findImportWindow() {
  const frames = document.querySelectorAll(".window-app, .application");
  for (const frame of frames) {
    if (frame.id?.startsWith("pk5e-")) continue;
    const title =
      frame.querySelector(".window-title, .window-header h4, header h1")?.textContent ?? "";
    const text = title.trim().toLowerCase();
    if (text && IMPORT_TITLES.some((needle) => text.includes(needle))) return frame;
  }
  return null;
}

function watchImport(onFinished, timeout = 300000) {
  const deadline = Date.now() + timeout;
  let appeared = false;
  let misses = 0;

  const tick = () => {
    const open = findImportWindow();
    if (open) {
      appeared = true;
      misses = 0;
    } else if (appeared) {
      // Plutonium closes one window before opening the next, so a single miss
      // does not mean it has finished. Require a run of them.
      misses += 1;
      if (misses >= 5) return onFinished();
    }
    if (Date.now() > deadline) return onFinished();
    setTimeout(tick, 300);
  };

  setTimeout(tick, 600);
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
/**
 * A one-sentence summary taken from whatever was imported.
 *
 * Compendium descriptions are HTML and often open with tables, headings or a
 * licence notice, so we strip the markup and take the first sentence that reads
 * like prose rather than boilerplate.
 */
function shortSummary(item) {
  const raw = item?.system?.description?.value ?? "";
  if (!raw) return "";

  const text = raw
    // Headings, tables and captions are structure, not prose - dropping them
    // whole stops fragments like "Traits 1" leaking into the sentence.
    .replace(/<(script|style|table|figure|caption)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";

  const boilerplate = /free rules|creative commons|re-distributed|source:|^\d/i;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const candidate = sentence.trim();
    if (candidate.length < 40 || boilerplate.test(candidate)) continue;
    return candidate.length > 220 ? `${candidate.slice(0, 217)}...` : candidate;
  }
  return "";
}

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
    // Size is worked out BEFORE super(): ApplicationV2 freezes this.options, so
    // it cannot be adjusted afterwards. Fill the available height rather than
    // opening as a narrow strip over the sheet, which was hard to read.
    const vw = globalThis.innerWidth ?? 1200;
    const vh = globalThis.innerHeight ?? 900;
    const width = Math.min(980, Math.max(360, vw - 40));
    const height = Math.max(520, vh - 40);

    super({
      ...options,
      position: {
        ...(options.position ?? {}),
        width,
        height,
        left: Math.max(20, Math.round((vw - width) / 2)),
        top: 20
      }
    });

    this.actorId = options.actorId ?? null;
    this._hooks = [];
    /** Per-step override of whether the explanation is expanded. */
    this._help = {};
    /** Step whose import is still running, if any. */
    this._importing = null;
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
      finalizeGuide: CreationGuide.onFinalizeGuide,
      setPortrait: CreationGuide.onSetPortrait,
      openReference: CreationGuide.onOpenReference,
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

    const portrait = actor.img ?? "";
    const hasPortrait =
      !!portrait && !portrait.includes("mystery-man") && !portrait.includes("svg/actors");

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
        help: HELP.species + importFlowNote(),
        removable: true,
        done: !!species,
        result: species?.name ?? "",
        img: species?.img ?? "",
        summary: shortSummary(species),
        blurb: text("textSpecies")
      },
      {
        key: "background",
        number: 3,
        label: "Background",
        icon: "fa-scroll",
        help: HELP.background + importFlowNote(),
        removable: true,
        done: !!background,
        result: background?.name ?? "",
        img: background?.img ?? "",
        summary: shortSummary(background),
        blurb: text("textBackground")
      },
      {
        key: "class",
        number: 4,
        label: "Class",
        icon: "fa-shield-halved",
        reference: true,
        help: HELP.class + importFlowNote(),
        removable: true,
        done: !!cls,
        result: cls ? `${cls.name} (level ${cls.system?.levels ?? 1})` : "",
        img: cls?.img ?? "",
        summary: shortSummary(cls),
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
      },
      {
        key: "portrait",
        number: 7,
        label: "Portrait",
        icon: "fa-image",
        removable: false,
        optional: true,
        action: "setPortrait",
        done: hasPortrait,
        result: hasPortrait ? "Portrait set" : "",
        img: hasPortrait ? actor.img : "",
        blurb: text("textPortrait")
      }
    ];

    const showHelp = game.settings.get(MODULE_ID, "showStepHelp");
    // Always collapsed to start with, so the steps stay scannable. The chevron
    // on the summary shows there is more to read.
    const helpDefault = false;
    for (const step of steps) {
      step.showHelp = showHelp && !!step.help;
      step.helpOpen = this._help[step.key] ?? helpDefault;
      step.importing = this._importing === step.key;
    }

    const report = checkCharacter(actor);
    const ownership = actor.ownership ?? {};

    return {
      actorName: actor.name,
      actorImg: actor.img ?? "",
      portrait: actor.img ?? "",
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
      allDone: steps.every((step) => step.done || step.optional),
      progress: (() => {
        // The name always counts as done, and is shown as step 1, so include it
        // here too - otherwise the tally silently disagrees with the numbering.
        const required = steps.filter((step) => !step.optional);
        const done = required.filter((step) => step.done).length + 1;
        return `${done} of ${required.length + 1} steps done`;
      })()
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
    const step = target.dataset.step;
    const pressed = await this.addFor(step);
    if (!pressed) return;

    this._importing = step;
    this.render();
    watchImport(() => {
      this._importing = null;
      this.render();
    });
  }

  /** Lets the player set the portrait without hunting for it on the sheet. */
  /** Opens the reading window for classes and subclasses. */
  static onOpenReference(event, target) {
    try {
      new ClassReference({ kind: target.dataset.kind ?? "class" }).render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not open the reference window`, err);
      ui.notifications.error(`Could not open the reference: ${err.message}`);
    }
  }

  static onSetPortrait() {
    const actor = this.actor;
    if (!actor) return;

    // The class moved namespaces across Foundry versions, so try each in turn.
    const candidates = [
      foundry.applications?.apps?.FilePicker?.implementation,
      foundry.applications?.apps?.FilePicker,
      globalThis.FilePicker
    ].filter(Boolean);

    if (!candidates.length) {
      ui.notifications.warn("The file picker is not available in this version.");
      return;
    }

    const apply = async (path) => {
      if (!path) return;
      try {
        await actor.update({ img: path, "prototypeToken.texture.src": path });
        ui.notifications.info("Portrait set.");
        this.render();
      } catch (err) {
        console.error(`${MODULE_ID} | Could not set the portrait`, err);
        ui.notifications.error(`Could not set the portrait: ${err.message}`);
      }
    };

    for (const FP of candidates) {
      try {
        const picker = new FP({ type: "image", current: actor.img, callback: apply });
        picker.render(true);
        return;
      } catch (err) {
        console.warn(`${MODULE_ID} | File picker variant failed, trying the next`, err);
      }
    }
    ui.notifications.error("Could not open the file picker. See the console for details.");
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

  /** Ends the guided run: opens the finished sheet and closes the panel. */
  static onFinalizeGuide() {
    const actor = this.actor;
    this.close();
    actor?.sheet.render(true);
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
