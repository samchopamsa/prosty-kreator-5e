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
import { watchOptionDialogs, skippedOptions, clearSkippedOptions } from "./option-watch.mjs";
import { migrateActor } from "./migrate.mjs";
import { trace } from "./trace.mjs";
import { postSummary } from "./summary.mjs";
import { importFlowNote, text, STEP_CONFIG, deleteWithAdvancement, confirmRemoval, grantExperienceFor, pressLevelUp, pressSheetButton, wait } from "./sheet-actions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
      removeStep: CreationGuide.onRemoveStep,
      redoStep: CreationGuide.onRedoStep,
      delevel: CreationGuide.onDelevel,
      dismissOption: CreationGuide.onDismissOption,
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

    // Which items were added with their choice dialogs skipped. Looked up once
    // per render and attached to the entry itself: collected at the bottom of
    // the panel the warning sat a long way from the thing it was about, and
    // with two classes there was no telling which one it meant.
    const skippedIds = new Set(itemsWithSkippedChoices(actor).map((problem) => problem.id));

    const entryFor = (item, label, summary, alsoCheck = null) => ({
      itemId: item.id,
      // Above level 1 a single level can be stepped back, which is far less
      // destructive than removing the class. Offered on the entry itself rather
      // than only alongside a detected problem: a player who realises they
      // misclicked should not have to wait for the module to notice.
      canDelevel: item.type === "class" && Number(item.system?.levels ?? 1) > 1,
      level: Number(item.system?.levels ?? 1),
      name: label ?? item.name,
      img: item.img ?? "",
      summary: summary ?? shortSummary(item),
      // A subclass is shown inside its class's entry, so its skipped choices
      // have to be reported there - removing the class takes it with it anyway.
      skipped: skippedIds.has(item.id) || (alsoCheck ? skippedIds.has(alsoCheck.id) : false),
      kind: t(`check.kind.${item.type}`),
      kindOf: t(`check.kindOf.${item.type}`)
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
          return entryFor(item, label, shortSummary(sub) || shortSummary(item), sub);
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
      // Marks the step head, so the problem is visible before scrolling down.
      step.hasSkipped = (step.entries ?? []).some((entry) => entry.skipped);
    }

    // Open the first time this character's panel is opened, folded away after
    // that. Worked out once per window rather than per render: setting the flag
    // updates the actor, which redraws, and the notice would collapse under the
    // reader mid-sentence.
    // Once per window, before anything reads the flags: a character made by an
    // older version may still be carrying the old shape of them.
    if (!this._migrated) {
      this._migrated = true;
      migrateActor(actor);
    }

    if (this._disclaimerOpen === undefined) {
      this._disclaimerOpen = !actor.getFlag(MODULE_ID, "disclaimerSeen");
      if (this._disclaimerOpen) {
        actor
          .setFlag(MODULE_ID, "disclaimerSeen", true)
          .catch((err) => console.warn(`${MODULE_ID} | Could not record the notice`, err));
      }
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
      disclaimerOpen: this._disclaimerOpen,
      report,
      // Surfaced separately from the checklist: this one has a fix attached,
      // and burying it among the other warnings buried the only actionable item.
      // Choices skipped inside Plutonium's dialogs. Kept apart from the
      // checklist because each one carries its own fix.
      skippedOptions: skippedOptions(actor).map((entry) => ({
        ...entry,
        // Level 1 means the class itself has to go and come back; above that a
        // single level can be undone, which is far less destructive.
        canDelevel: Number(entry.level) > 1 && classes.length > 0,
        classId: classes[0]?.id ?? null,
        // Each kind of unfinished choice reads differently: spells count what
        // was learned, an ability increase counts points left, a dropdown just
        // sits unset. One generic sentence covered none of them well.
        text: (() => {
          if (entry.reason !== "partial") {
            return entry.level
              ? t("option.skippedAt", entry.label, entry.level)
              : t("option.skipped", entry.label);
          }
          if (entry.total != null) return t("option.partial", entry.label, entry.learned, entry.total);
          if (entry.remaining != null) return t("option.partialAsi", entry.label, entry.remaining);
          return t("option.partialSelect", entry.label);
        })()
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

    // The notice at the top needs the same treatment: it was folding itself
    // back open on every redraw, which is every time a step is completed.
    const disclaimer = this.element.querySelector(".pk5e-disclaimer");
    if (disclaimer) {
      disclaimer.addEventListener("toggle", () => {
        this._disclaimerOpen = disclaimer.open;
      });
    }

    if (!this._hooks.length) this.registerWatchers();

    // Plutonium's own dialogs leave no trace in the data, so they have to be
    // watched live. Only while this panel is open, which is the whole scope the
    // creator claims responsibility for.
    if (!this._stopOptionWatch) {
      this._stopOptionWatch = watchOptionDialogs(
        this.actor,
        () => this.render(),
        ({ cancelled }) => {
          // "Import Complete" is the importer saying it is done. Until it
          // appears the step stays marked as in progress, which also covers the
          // case that prompted this: a dialog buried under another window.
          this._importing = null;
          this._importCancelled = cancelled;
          this.render();
        }
      );
    }
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
    this._stopOptionWatch?.();
    this._stopOptionWatch = null;

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
      // Anything recorded about this item goes with it. Adding it again walks
      // through the same dialogs, so the record rebuilds itself if it should.
      if (["species", "background", "class"].includes(step)) {
        await clearSkippedOptions(this.actor);
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

    // This used to be guesswork - watch for activity, give up after a quiet
    // spell - and every threshold that stopped it clearing too early made it
    // linger long after the work was done. The importer's own "Import Complete"
    // window settles it, so the notice now ends when the importer says so.
    if (!game.settings.get(MODULE_ID, "showImportingNotice")) return;

    this._importing = step;
    this._importCancelled = false;
    this._lastActivity = Date.now();
    this.render();

    // Still a fallback: if the player closes the panel and reopens it mid-import
    // the watcher missed the completion, and the notice must not stick forever.
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

  static async onRemoveStep(event, target) {
    await this.removeFor(target.dataset.step, { itemId: target.dataset.item ?? null });
  }

  /**
   * Steps one class level back so the choices for it can be made again.
   *
   * Far gentler than removing the class outright, which is what a level 1
   * mistake needs but a level 7 one certainly does not: the system reverses the
   * one level and everything below it stays as it was.
   */
  static async onDelevel(event, target) {
    const actor = this.actor;
    const classId = target.dataset.classId;
    const item = actor?.items?.get(classId);
    if (!item) return;

    const AdvancementManager =
      game.dnd5e?.applications?.advancement?.AdvancementManager ??
      globalThis.dnd5e?.applications?.advancement?.AdvancementManager;

    if (!AdvancementManager?.forLevelChange) {
      ui.notifications.warn(t("option.noDelevel"));
      return;
    }

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("option.delevelTitle") },
      content: `<p>${t("option.delevelBody", item.name, item.system?.levels ?? 1)}</p>`,
      modal: true
    });
    if (!confirmed) return;

    try {
      const manager = AdvancementManager.forLevelChange(actor, classId, -1);
      if (manager?.steps?.length) manager.render(true);
      // The record belongs to the level being undone; re-levelling records anew.
      await clearSkippedOptions(actor, {
        label: target.dataset.label,
        level: Number(target.dataset.level) || null
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not step the level back`, err);
      ui.notifications.warn(t("option.noDelevel"));
    }
  }

  /**
   * Forgets one recorded option.
   *
   * The record cannot tell that the player went and sorted it out by hand, so
   * without this an entry could sit there forever, insisting on a problem that
   * no longer exists.
   */
  static async onDismissOption(event, target) {
    await clearSkippedOptions(this.actor, {
      label: target.dataset.label,
      level: Number(target.dataset.level) || null
    });
    this.render();
  }

  /**
   * Removes an item whose choices were skipped and immediately offers it again.
   *
   * Two separate operations for the player would mean remembering what to
   * re-add and finding it a second time, at the exact moment they have just
   * been told they did something wrong.
   */
  /**
   * Removes an item whose choices were skipped.
   *
   * It used to re-open the importer straight afterwards, which sounded helpful
   * and was not: removing opens the system's advancement reversal window, so
   * the sheet is busy and the re-add never actually fired. All it managed was
   * to open the class reading panel over the top of nothing. Now it removes,
   * and the player presses the step's own button when the sheet has settled -
   * exactly what plain Remove does.
   */
  static async onRedoStep(event, target) {
    await this.removeFor(target.dataset.step, { itemId: target.dataset.item ?? null });
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
