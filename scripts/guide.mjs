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
import { LanguagePicker, languageLabels } from "./languages.mjs";
import { ClassReference } from "./reference.mjs";
import { ImporterPanel, openImporterPanel } from "./importer-panel.mjs";
import { t, currentLanguage, LANGUAGE_CHOICES } from "./i18n.mjs";
import { preserveScroll } from "./ui.mjs";
import { checkCharacter, itemsWithSkippedChoices } from "./validate.mjs";
import { postSummary } from "./summary.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Name given to a freshly created character, and the pattern we may replace. */
const DEFAULT_NAME = "New Character";

/** Readable names for the ability score methods stored on the actor. */
const METHOD_KEYS = {
  standard: "method.standard",
  pointbuy: "method.pointbuy",
  roll: "method.roll",
  manual: "method.manual"
};
const AUTO_NAME = /^New Character for .+$/;

/** Wording the GM can override in the module settings. */


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
  if (mode === "plutonium" || plutoniumAnswersItself()) return t("flow.plutonium");
  if (mode === "compendium") return t("flow.compendium");
  return t("flow.prompt");
}



/**
 * The GM's own wording wins; otherwise the translated default. A GM who has
 * written custom text presumably wants exactly that text, in any language.
 */
function text(settingKey, translationKey) {
  const custom = game.settings.get(MODULE_ID, settingKey);
  if (typeof custom === "string" && custom.trim()) return custom;
  return t(translationKey);
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
/**
 * Whether Plutonium has been configured to skip its own importer question.
 * Read through its public config API; if that is unavailable we assume it still
 * asks, which is the safe direction - at worst we wait a moment for nothing.
 */
function plutoniumAnswersItself() {
  try {
    const value = globalThis.plutonium?.config?.getValue?.("actor", "addButtonMode");
    // 0 Never, 1 Prompt, 2 Always - anything other than Prompt means no dialog.
    return value !== undefined && value !== 1;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read Plutonium's addButtonMode`, err);
    return false;
  }
}

async function autoAdvance() {
  const isGM = game.user?.isGM;
  const mode = game.settings.get(MODULE_ID, isGM ? "autoAdvanceGm" : "autoAdvance");
  const skipSources = game.settings.get(
    MODULE_ID,
    isGM ? "skipSourceScreenGm" : "skipSourceScreen"
  );

  // Step one: the "Use Plutonium / Use Compendium Browser" choice.
  //
  // Plutonium can be told to stop asking, via its own "Use Importer when Using
  // ADD ... Button on Actor" setting. When it is, waiting for a window that will
  // never appear just adds four seconds to every step, so we ask Plutonium first.
  if (mode && mode !== "off" && !plutoniumAnswersItself()) {
    const label = mode === "plutonium" ? "use plutonium" : "use compendium browser";
    const chooser = await waitForButton([label], 4000);
    if (chooser) chooser.click();
    // The compendium browser opens straight onto its list; nothing else to skip.
    if (mode === "compendium") return;
  }

  // Step two: the data source screen, closed by pressing "Open Importer".
  // Independent of step one on purpose - you may want to pick the importer
  // yourself and still not be asked about sources every time.
  if (!skipSources) return;

  const opener = await waitForButton(["open importer"], 12000);
  if (!opener) return;

  // Keep Window Open lives ONLY on the screen we are about to skip, so a player
  // who had it ticked would never get another chance to untick it. We therefore
  // untick it here, doing exactly what they would have done.
  if (game.settings.get(MODULE_ID, "uncheckKeepOpen")) {
    const keepOpen = findKeepOpenCheckbox();
    if (keepOpen?.checked) {
      keepOpen.click();
      console.log(`${MODULE_ID} | Unticked "Keep Window Open" before opening the importer.`);
    }
  }

  opener.click();
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
/**
 * Plutonium's own level-up button on the character sheet. It carries no text and
 * no data-action, so it is matched on a fragment of its class name - the same
 * approach as everywhere else here: recognise what a person would point at, and
 * do nothing if it is not there.
 *
 * The window it opens offers both the next level and "Add New Class
 * (Multiclass)", so one button covers both.
 */
const LEVEL_UP_SELECTORS = [
  ".imp-cls__btn-sheet-level-up",
  "[class*='btn-sheet-level-up']",
  "[class*='level-up']"
];

/**
 * Experience needed for each character level. Read from the system so a world
 * with altered thresholds still works; the table is only a fallback.
 */
function experienceTable() {
  const fromSystem = CONFIG.DND5E?.CHARACTER_EXP_LEVELS;
  if (Array.isArray(fromSystem) && fromSystem.length >= 20) return fromSystem;
  return [
    0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
    85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000
  ];
}

/**
 * Asks which level the character should reach and tops up experience to match.
 *
 * Plutonium's level-up button refuses to advance a character that has not earned
 * the experience, which is correct for play but pointless when building a
 * character that is meant to start at level five. Experience is only ever raised,
 * never lowered, so nothing already earned is thrown away.
 */
async function grantExperienceFor(actor) {
  const table = experienceTable();
  const currentXp = Number(actor.system?.details?.xp?.value ?? 0);
  const currentLevel = actor.items
    .filter((i) => i.type === "class")
    .reduce((sum, i) => sum + (i.system?.levels ?? 0), 0);

  const options = table
    .map((xp, index) => ({ level: index + 1, xp }))
    .filter((entry) => entry.level > Math.max(1, currentLevel))
    .map((entry) => `<option value="${entry.level}">Level ${entry.level} (${entry.xp} XP)</option>`)
    .join("");

  if (!options) {
    ui.notifications.info("Already at the highest level in the table.");
    return true;
  }

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.prompt) {
    ui.notifications.warn("Cannot ask for a target level in this version; set experience by hand.");
    return true;
  }

  let target = null;
  try {
    target = await DialogV2.prompt({
      window: { title: "Level up" },
      content: `<p>Currently level ${currentLevel || 1}, ${currentXp} XP.
                Choose the level to reach - experience will be topped up to match.</p>
                <select name="level" style="width:100%">${options}</select>`,
      ok: { callback: (event, button) => Number(button.form.elements.level.value) }
    });
  } catch (err) {
    // Dialog cancelled: leave the sheet alone entirely.
    return false;
  }

  if (!target) return false;

  const needed = table[target - 1] ?? 0;
  if (needed > currentXp) {
    try {
      await actor.update({ "system.details.xp.value": needed });
      ui.notifications.info(`Experience set to ${needed} for level ${target}.`);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not set experience`, err);
      ui.notifications.error(`Could not set experience: ${err.message}`);
      return false;
    }
  }
  return true;
}

async function pressLevelUp(actor) {
  const sheet = actor.sheet;
  if (!sheet.rendered) {
    await sheet.render(true);
    await wait(300);
  }

  // A disabled button looks identical to a missing one when clicked: nothing
  // happens. Plutonium disables it while the character lacks the experience for
  // the next level, so we tell the two cases apart and say which it is.
  const isDisabled = (el) =>
    el.disabled ||
    el.getAttribute("aria-disabled") === "true" ||
    /\bdisabled\b/.test(el.className);

  const findAll = () => {
    const seen = new Set();
    for (const selector of LEVEL_UP_SELECTORS) {
      for (const el of actor.sheet.element?.querySelectorAll(selector) ?? []) seen.add(el);
    }
    return Array.from(seen);
  };

  const find = () => findAll().find((el) => !isDisabled(el)) ?? null;

  // Plutonium injects this button after the sheet has rendered, so a single
  // look straight away finds nothing. Poll for a few seconds instead.
  let button = null;
  const deadline = Date.now() + 3000;
  while (!button && Date.now() < deadline) {
    button = find();
    if (button) break;
    await wait(200);
  }

  if (!button) {
    await ensureEditMode(actor);
    await wait(500);
    button = find();
  }

  if (!button) {
    const blocked = findAll();
    if (blocked.length) {
      console.warn(`${MODULE_ID} | Level-up button found but disabled`, blocked[0].className);
      ui.notifications.warn(
        "The level-up button is disabled, which means the character has not got the experience for the next level. Set 'How levelling works at your table' to Experience, or put the dnd5e system into its no-experience mode.",
        { permanent: true }
      );
      return false;
    }

    console.warn(`${MODULE_ID} | No level-up button matched`, LEVEL_UP_SELECTORS);
    ui.notifications.warn(
      "Could not find the level-up button on the sheet. It comes from Plutonium, so it appears only while Plutonium is active."
    );
    return false;
  }

  console.log(`${MODULE_ID} | Pressing Plutonium's level-up button.`);
  button.click();
  return true;
}

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
 * A short summary taken from whatever was imported.
 *
 * Works on paragraphs rather than the flattened text. Captions, headings, trait
 * tables and artist credits are not paragraphs of prose, so filtering at that
 * level removes them without guessing. Foundry enricher syntax (@UUID[...],
 * [[/r ...]], &Reference[...]) is stripped too - it is markup, not writing.
 */
function shortSummary(item) {
  const raw = item?.system?.description?.value ?? "";
  if (!raw) return "";

  const stripped = raw
    .replace(/<(script|style|table|figure|figcaption)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, " ");

  const clean = (html) =>
    html
      .replace(/@\w+\[[^\]]*\](?:\{[^}]*\})?/g, " ")
      .replace(/&\w+\[[^\]]*\](?:\{[^}]*\})?/g, " ")
      .replace(/\[\[[^\]]*\]\]/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
      .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
      .replace(/&mdash;/g, "-")
      .replace(/\s+/g, " ")
      .trim();

  const paragraphs = Array.from(stripped.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map((m) =>
    clean(m[1])
  );
  const candidates = paragraphs.length ? paragraphs : [clean(stripped)];

  const boilerplate = /free rules|creative commons|re-distributed|^source\b/i;

  for (const paragraph of candidates) {
    if (paragraph.length < 60 || boilerplate.test(paragraph)) continue;

    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let text = sentences[0]?.trim() ?? "";
    // One sentence is often too terse; take a second if there is room.
    if (text.length < 110 && sentences[1]) text = `${text} ${sentences[1].trim()}`;
    if (text.length < 40) continue;

    return text.length > 260 ? `${text.slice(0, 257)}...` : text;
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
    /** When something last landed on the actor, used to detect a finished import. */
    this._lastActivity = 0;
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
      redoStep: CreationGuide.onRedoStep,
      openSheet: CreationGuide.onOpenSheet,
      finalizeGuide: CreationGuide.onFinalizeGuide,
      setPortrait: CreationGuide.onSetPortrait,
      setDefaultFolder: CreationGuide.onSetDefaultFolder,
      levelUp: CreationGuide.onLevelUp,
      openReference: CreationGuide.onOpenReference,
      setLanguage: CreationGuide.onSetLanguage,
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
    // A player making their own character owns it from the start, and the name
    // says whose it is - otherwise the GM sees a row of identical entries.
    const isPlayer = !game.user.isGM;
    const ownership = isPlayer
      ? { [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
      : {};

    // Filed on creation rather than afterwards, so nothing ever sits loose at
    // the top of the directory - including characters made by players, who have
    // no folder control of their own.
    let folder = null;
    try {
      const configured = game.settings.get(MODULE_ID, "defaultActorFolder");
      if (configured && game.folders.get(configured)) folder = configured;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read the default folder`, err);
    }

    const actor = await Actor.implementation.create({
      name: isPlayer ? `${DEFAULT_NAME} for ${game.user.name}` : DEFAULT_NAME,
      type: "character",
      folder,
      ownership,
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
    // Every class, not just the first: a multiclassed character would otherwise
    // silently lose half its build on this step.
    const classes = actor.items.filter((i) => i.type === "class");
    const subclasses = actor.items.filter((i) => i.type === "subclass");

    const subclassFor = (item) =>
      subclasses.find(
        (sub) =>
          !item.system?.identifier ||
          sub.system?.classIdentifier === item.system.identifier
      );

    const cls = classes[0] ?? null;
    const subclass = cls ? subclassFor(cls) : null;

    const classLine = classes
      .map((item) => {
        const sub = subclassFor(item);
        return `${item.name} ${item.system?.levels ?? 1}${sub ? ` - ${sub.name}` : ""}`;
      })
      .join(" · ");

    const totalLevel = classes.reduce((sum, item) => sum + (item.system?.levels ?? 0), 0);
    const savedAbilities = actor.getFlag(MODULE_ID, "abilities");
    const abilitiesDone = !!savedAbilities;
    const abilityMethod = METHOD_KEYS[savedAbilities?.method]
      ? t(METHOD_KEYS[savedAbilities.method])
      : "";

    const portrait = actor.img ?? "";
    const hasPortrait =
      !!portrait && !portrait.includes("mystery-man") && !portrait.includes("svg/actors");

    const known = actor.system?.traits?.languages?.value;
    const languageKeys = known ? Array.from(known) : [];
    const languageCount = languageKeys.length;

    // Headline counts, detail below the line - same shape as the other steps.
    let languageHeadline = "";
    let languageSummary = "";
    if (languageCount) {
      const MAX_SHOWN = 10;
      const labels = languageLabels(languageKeys);
      const shown = labels.slice(0, MAX_SHOWN).join(", ");
      const rest = labels.length > MAX_SHOWN ? " (...)" : "";
      languageHeadline =
        languageCount === 1 ? t("guide.languageCountOne") : t("guide.languageCount", languageCount);
      languageSummary = `${shown}${rest}`;
    }

    const entryFor = (item, label, summary) => ({
      itemId: item.id,
      name: label ?? item.name,
      img: item.img ?? "",
      summary: summary ?? shortSummary(item)
    });

    const steps = [
      {
        key: "species",
        number: 2,
        label: t("step.species"),
        actionLabel: t("stepAcc.species"),
        icon: "fa-dna",
        help: t("help.species") + importFlowNote(),
        removable: true,
        done: !!species,
        entries: species ? [entryFor(species)] : [],
        blurb: text("textSpecies", "blurb.species")
      },
      {
        key: "background",
        number: 3,
        label: t("step.background"),
        actionLabel: t("stepAcc.background"),
        icon: "fa-scroll",
        help: t("help.background") + importFlowNote(),
        removable: true,
        done: !!background,
        entries: background ? [entryFor(background)] : [],
        blurb: text("textBackground", "blurb.background")
      },
      {
        key: "class",
        number: 4,
        label: t("step.class"),
        actionLabel: t("stepAcc.class"),
        icon: "fa-shield-halved",
        reference: true,
        levelUp: classes.length > 0,
        help: t("help.class") + importFlowNote(),
        removable: true,
        done: classes.length > 0,
        entries: classes.map((item) => {
          const sub = subclassFor(item);
          const label = `${item.name} ${item.system?.levels ?? 1}${sub ? ` - ${sub.name}` : ""}`;
          return entryFor(item, label, shortSummary(sub) || shortSummary(item));
        }),
        multiclass: classes.length > 1,
        totalLevel,
        blurb: text("textClass", "blurb.class")
      },
      {
        key: "abilities",
        number: 5,
        label: t("step.abilities"),
        actionLabel: t("stepAcc.abilities"),
        icon: "fa-dice-d20",
        help: t("help.abilities"),
        removable: false,
        done: abilitiesDone,
        result: abilitiesDone
          ? Object.entries(actor.system?.abilities ?? {})
              .map(([, v]) => v.value)
              .join(" / ")
          : "",
        summary: abilityMethod,
        img: "",
        blurb: text("textAbilities", "blurb.abilities")
      },
      {
        key: "languages",
        number: 6,
        label: t("step.languages"),
        actionLabel: t("stepAcc.languages"),
        icon: "fa-comments",
        help: t("help.languages"),
        removable: false,
        action: "languages",
        done: !!actor.getFlag(MODULE_ID, "languages"),
        result: languageHeadline,
        summary: languageSummary,
        img: "",
        blurb: text("textLanguages", "blurb.languages")
      },
      {
        key: "portrait",
        number: 7,
        label: t("step.portrait"),
        actionLabel: t("stepAcc.portrait"),
        icon: "fa-image",
        removable: false,
        optional: true,
        action: "setPortrait",
        done: hasPortrait,
        result: hasPortrait ? t("guide.portraitSet") : "",
        img: hasPortrait ? actor.img : "",
        blurb: text("textPortrait", "blurb.portrait")
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
      nameHelp: showHelp ? t("help.name") : "",
      nameHelpOpen: this._help.name ?? helpDefault,
      introText: text("introText"),
      isGM: game.user.isGM,
      languages: Object.entries(LANGUAGE_CHOICES).map(([code, label]) => ({
        code,
        label,
        selected: code === currentLanguage()
      })),
      report,
      // Surfaced separately from the checklist: this one has a fix attached,
      // and burying it among the other warnings buried the only actionable item.
      skipped: itemsWithSkippedChoices(actor).map((problem) => ({
        ...problem,
        step: problem.type === "background" ? "background" : problem.type === "class" || problem.type === "subclass" ? "class" : "species",
        // Two forms: "(pochodzenie)" after the verb, "dla pochodzenia" after
        // the preposition. English repeats the same word for both.
        kind: t(`check.kind.${problem.type}`),
        kindOf: t(`check.kindOf.${problem.type}`)
      })),
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
      folderIsDefault:
        !!actor.folder?.id &&
        actor.folder.id === game.settings.get(MODULE_ID, "defaultActorFolder"),
      defaultFolderName:
        game.folders.get(game.settings.get(MODULE_ID, "defaultActorFolder"))?.name ?? "",
      steps,
      allDone: steps.every((step) => step.done || step.optional),
      progress: (() => {
        // Every step is counted, optional ones included, because the intro
        // promises seven and the numbering shows seven. A tally that quietly
        // drops the portrait reads as a contradiction in the same window.
        const done = steps.filter((step) => step.done).length + 1;
        return t("guide.progress", done, steps.length + 1);
      })()
    };
  }

  _onRender() {
    preserveScroll(this, [".pk5e-pane"]);

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

      // Name the character after its player while it is still unnamed. A row of
      // sheets all called "New Character" is impossible to tell apart. A name
      // the player has actually chosen is never touched.
      const currentName = this.actor?.name ?? "";
      const isPlaceholder = currentName === DEFAULT_NAME || AUTO_NAME.test(currentName);
      if (isPlaceholder) {
        const player = chosen ? game.users.get(chosen) : null;
        update.name = player ? `${DEFAULT_NAME} for ${player.name}` : DEFAULT_NAME;
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
    const onItem = (doc, added = false) => {
      if (doc?.parent?.id !== this.actorId) return;
      // Items still arriving means the import is still running.
      if (this._importing) this._lastActivity = Date.now();

      // The reading window exists to help with one decision. Once the class is
      // on the sheet the decision is made, so it goes away by itself rather
      // than sitting over the importer's remaining dialogs. Only on arrival:
      // removing a class is a reason to go back to reading, not to stop.
      if (added && ["class", "subclass"].includes(doc.type)) {
        ClassReference.closeIfOpen();
        ImporterPanel.closeIfOpen();
      }

      this.render();
    };
    this._hooks.push(["createItem", Hooks.on("createItem", (doc) => onItem(doc, true))]);
    for (const hook of ["deleteItem", "updateItem"]) {
      this._hooks.push([hook, Hooks.on(hook, (doc) => onItem(doc, false))]);
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

    // Closing counts as "I have seen this" - but ONLY for a player. The GM
    // normally opens the panel first to assign the character, and marking it
    // dismissed then meant the player never got the automatic opening at all.
    try {
      if (!game.user.isGM && this.actor?.isOwner && !this.actor.getFlag(MODULE_ID, "guideDismissed")) {
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
  async removeFor(step, { confirm = true, itemId = null } = {}) {
    // With an id we remove just that one - a multiclassed character must be
    // able to drop a single class without losing the rest.
    const all = this.itemsFor(step);
    const items = itemId ? all.filter((i) => i.id === itemId) : all;
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

    // The importer lists class names with nothing to read, so open the narrow
    // panel beside it. That one follows whatever the player highlights; the
    // wide reference window stays available from the link in this step.
    if (step === "class" && game.settings.get(MODULE_ID, "openReferenceWithClass")) {
      try {
        openImporterPanel();
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not open the panel alongside`, err);
      }
    }

    const pressed = await this.addFor(step);
    if (!pressed) return;

    // Off by default. Detecting when someone else's import has finished means
    // watching their windows, and every threshold that stopped it clearing too
    // early also made it linger long after the work was done. Marking the step
    // as soon as the item lands is slightly premature but never annoying.
    if (!game.settings.get(MODULE_ID, "showImportingNotice")) return;

    this._importing = step;
    this._lastActivity = Date.now();
    this.render();

    watchImport(
      () => this._lastActivity,
      () => {
        this._importing = null;
        this.render();
      }
    );
  }

  /** Lets the player set the portrait without hunting for it on the sheet. */
  /** Opens the reading window for classes and subclasses. */
  /** Per-user language switch; does not touch anyone else's view. */
  static async onSetLanguage(event, target) {
    try {
      await game.settings.set(MODULE_ID, "language", target.dataset.lang);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not change the panel language`, err);
    }
  }

  static onOpenReference(event, target) {
    try {
      new ClassReference({ kind: target.dataset.kind ?? "class" }).render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not open the reference window`, err);
      ui.notifications.error(`Could not open the reference: ${err.message}`);
    }
  }

  /** Remembers the folder currently chosen as the destination for new characters. */
  /** Opens Plutonium's level-up window, which also offers multiclassing. */
  static async onLevelUp() {
    const actor = this.actor;
    if (!actor) return;

    if (game.settings.get(MODULE_ID, "levelUpMode") === "xp") {
      const ready = await grantExperienceFor(actor);
      if (!ready) return;

      // The button is only re-enabled when the sheet redraws with the new
      // experience, so force that before going looking for it.
      if (actor.sheet.rendered) {
        await actor.sheet.render();
        await wait(500);
      }
    }

    await pressLevelUp(actor);
  }

  static async onSetDefaultFolder() {
    const current = this.actor?.folder?.id ?? "";
    const stored = game.settings.get(MODULE_ID, "defaultActorFolder");
    const next = stored === current ? "" : current;

    try {
      await game.settings.set(MODULE_ID, "defaultActorFolder", next);
      const folder = next ? game.folders.get(next) : null;
      ui.notifications.info(
        folder
          ? `New characters will be created in "${folder.name}".`
          : "New characters will no longer be filed automatically."
      );
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not store the default folder`, err);
      ui.notifications.error(`Could not store the default folder: ${err.message}`);
    }
  }

  static async onSetPortrait() {
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

    console.log(`${MODULE_ID} | Opening the file picker, ${candidates.length} variant(s) available.`);

    for (const [index, FP] of candidates.entries()) {
      try {
        const picker = new FP({ type: "image", current: actor.img, callback: apply });
        picker.render(true);
        console.log(`${MODULE_ID} | File picker opened using variant ${index + 1}.`);
        return;
      } catch (err) {
        console.warn(`${MODULE_ID} | File picker variant ${index + 1} failed`, err);
      }
    }

    // Every variant refused, so fall back to typing a path. Better than a dead
    // button, and it keeps working whatever Foundry does with the picker class.
    const DialogV2 = foundry.applications?.api?.DialogV2;
    if (DialogV2?.prompt) {
      try {
        const path = await DialogV2.prompt({
          window: { title: "Portrait" },
          content: `<p>The file picker could not be opened. Paste an image path:</p>
                    <input type="text" name="path" value="${actor.img ?? ""}" style="width:100%">`,
          ok: { callback: (event, button) => button.form.elements.path.value.trim() }
        });
        await apply(path);
        return;
      } catch (err) {
        console.warn(`${MODULE_ID} | Path prompt cancelled or unavailable`, err);
        return;
      }
    }
    ui.notifications.error("Could not open the file picker. See the console for details.");
  }

  static async onReplaceStep(event, target) {
    const step = target.dataset.step;
    const removed = await this.removeFor(step, { itemId: target.dataset.item ?? null });
    if (!removed) return;
    await wait(200);
    await this.addFor(step);
  }

  static async onRemoveStep(event, target) {
    await this.removeFor(target.dataset.step, { itemId: target.dataset.item ?? null });
  }

  /**
   * Removes an item whose choices were skipped and immediately offers it again.
   *
   * Two separate operations for the player would mean remembering what to
   * re-add and finding it a second time, at the exact moment they have just
   * been told they did something wrong.
   */
  static async onRedoStep(event, target) {
    const step = target.dataset.step;
    const removed = await this.removeFor(step, { itemId: target.dataset.item ?? null });
    if (!removed) return;

    // The removal may open the system's advancement reversal window; give the
    // sheet a moment to settle before reaching for its buttons.
    await wait(400);
    await CreationGuide.onAddStep(event, target);
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
