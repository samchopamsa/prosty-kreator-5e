/**
 * guide.mjs
 * ---------------------------------------------------------------------------
 * Guided character creation that drives the sheet's own buttons.
 *
 * We do not reimplement anything. Each step clicks the real "Add Species",
 * "Add Background" or "Add Class" button on the character sheet, so whatever
 * the system and the importer have attached to it runs exactly as it would if the
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
import { ImporterPanel, openImporterPanel } from "./importer-panel.mjs";
import { t, currentLanguage, LANGUAGE_CHOICES } from "./i18n.mjs";
import { preserveScroll, applyTheme, currentTheme, THEMES } from "./ui.mjs";
import { checkCharacter } from "./validate.mjs";
import { rulesChecks } from "./checkup.mjs";
import { folderChoices, uniqueActorName, tokenNameUpdate } from "./naming.mjs";
import { watchOptionDialogs, skippedOptions, clearSkippedOptions } from "./option-watch.mjs";
import { migrateActor } from "./migrate.mjs";
import { buildSteps } from "./steps.mjs";
import { watchImportEnd } from "./import-end.mjs";
import {
  SOURCES,
  SOURCE_COMPENDIUM,
  currentSource,
  importerAvailable,
  setSource,
  usesCompendium
} from "./source-mode.mjs";
import { trace } from "./trace.mjs";
import { postSummary } from "./summary.mjs";
import { text, STEP_CONFIG, deleteWithAdvancement, confirmRemoval, grantExperienceFor, pressLevelUp, pressSheetButton, wait } from "./sheet-actions.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Name given to a freshly created character, and the pattern we may replace. */
const DEFAULT_NAME = "New Character";

const AUTO_NAME = /^New Character for .+$/;

/** Wording the GM can override in the module settings. */


/**
 * Plain-language explanations for someone who has never built a character.
 * Written from the rules themselves rather than copied from anywhere.
 */

/** The names the module gives a character before anyone has chosen one. */
/**
 * Foundry adds " (2)", " (3)" and so on when a name is already taken, and those
 * copies are no more named than the original.
 */
function withoutCopyNumber(name) {
  return name.replace(/\s*\(\d+\)\s*$/, "").trim();
}

export function hasPlaceholderName(actor) {
  const raw = (actor?.name ?? "").trim();
  // An empty name is not a chosen one either.
  if (!raw) return true;

  const name = withoutCopyNumber(raw);
  if (name === DEFAULT_NAME || AUTO_NAME.test(name)) return true;

  // Characters made outside this module carry Foundry's own default instead -
  // "Player Character" in dnd5e, translated in other languages. Asked for
  // rather than listed, so it stays right in a Polish or German world.
  try {
    const fallback = CONFIG.Actor?.documentClass?.defaultName?.({ type: "character" });
    if (fallback && withoutCopyNumber(String(fallback)) === name) return true;
  } catch (err) {
    // Called before the document classes are ready; not worth reporting.
  }

  // The label dnd5e gives the type, which is what that default is built from.
  const typeLabel = game.i18n?.localize?.("TYPES.Actor.character");
  if (typeLabel && typeLabel !== "TYPES.Actor.character" && typeLabel === name) return true;

  return false;
}

export function missingSteps(actor) {
  if (!actor || actor.type !== "character") return [];
  const missing = [];

  // A character always has a name, so this used to be treated as done from the
  // start - and the count on the sheet button was one short of what the panel
  // showed. "New Character" is a name nobody chose, and choosing one is a step.
  if (hasPlaceholderName(actor)) missing.push("name");

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
      setLanguage: CreationGuide.onSetLanguage,
      setSource: CreationGuide.onSetSource,
      setTheme: CreationGuide.onSetTheme,
      finalise: CreationGuide.onFinalise,
      languages: CreationGuide.onLanguages,
      postSummary: CreationGuide.onPostSummary,
      recheck: CreationGuide.onRecheck
    }
  };

  /**
   * Names the window after what it is, with the character after it.
   *
   * It was showing the character's name alone, which on a fresh character is
   * "New Character" - indistinguishable from the sheet behind it, and blank
   * once the player types something short. With two panels open there was no
   * telling them apart either.
   */
  get title() {
    const name = this.actor?.name ?? "";
    const base = t("guide.windowTitle");
    return name ? `${base} - ${name}` : base;
  }

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

    // Numbered when the name is already taken. A player can reach this more
    // than once, and a world with two identically named sheets is one where
    // every later question - which one is finished, which one to check - has
    // no answer without opening both.
    const wanted = isPlayer ? `${DEFAULT_NAME} for ${game.user.name}` : DEFAULT_NAME;
    // Computed once and used for both the actor and its token, so the two
    // cannot drift apart before the character has even been opened.
    const name = uniqueActorName(wanted);

    const actor = await Actor.implementation.create({
      name,
      type: "character",
      folder,
      ownership,
      prototypeToken: {
        // Set here as well as watched afterwards: a token created before the
        // first rename would otherwise carry the placeholder until something
        // else changed.
        name,
        actorLink: true,
        disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
        sight: { enabled: true }
      }
    });
    if (!actor) return null;
    await actor.sheet.render(true);
    return CreationGuide.open(actor.id);
  }

  /**
   * Wrapped so that one bad reference cannot cost the player the whole panel.
   *
   * The guard used to sit around buildSteps() only, on the assumption that the
   * steps were the risky part. Then a variable left behind by a file split
   * threw two lines further down and the window came up empty - no steps, no
   * checklist, no way back to the character. The narrower guard was worse than
   * useless: it made the failure look handled.
   */
  async _prepareContext(...args) {
    try {
      return await this.buildContext(...args);
    } catch (err) {
      console.error(`${MODULE_ID} | The panel could not be prepared`, err);
      return { missing: false, panelFailed: true, actorName: this.actor?.name ?? "" };
    }
  }

  async buildContext() {
    const actor = this.actor;
    if (!actor) return { missing: true };
    // Guarded because everything else on the panel is still worth showing if
    // this fails. A damaged item, or a field the system moved in an update,
    // would otherwise leave the player looking at an empty window with no idea
    // why - and no way back to the character.
    let steps = [];
    let stepsFailed = false;
    try {
      steps = buildSteps(actor, { importing: !!this._importing });
    } catch (err) {
      stepsFailed = true;
      console.error(`${MODULE_ID} | Could not build the steps for ${actor.name}`, err);
    }

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

    // Read here as well as in steps.mjs: the delevel offer below needs a class
    // to act on, and the split left this reference pointing at nothing.
    const classes = actor.items.filter((i) => i.type === "class");

    const report = checkCharacter(actor);

    // Rules comparison, folded into the same list. Awaited here rather than
    // rendered separately so the player reads one checklist, not two, and so a
    // slow or absent rules data simply contributes nothing.
    const fromRules = await rulesChecks(actor);
    if (fromRules.length) {
      report.checks.push(...fromRules);
      const added = fromRules.filter((c) => !c.ok).length;
      report.warnings += added;
      report.problems = (report.problems ?? 0) + added;
    }

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
      themes: THEMES.map((code) => ({
        code,
        label: t(`theme.${code}`),
        selected: code === currentTheme()
      })),
      disclaimerOpen: this._disclaimerOpen,
      // The fork between the two routes. Only ever offered when there is
      // something to choose between: without the importer installed there is
      // one road, and drawing a pair of buttons where one is unreachable would
      // be inventing a decision.
      sourceAsk: importerAvailable() && !currentSource(actor),
      sourceChoices: importerAvailable()
        ? SOURCES.map((code) => ({
            code,
            label: t(`source.${code}`),
            hint: t(`source.${code}Hint`),
            icon: code === SOURCE_COMPENDIUM ? "fa-book-atlas" : "fa-file-import",
            selected: code === currentSource(actor)
          }))
        : [],
      stepsFailed,
      report,
      // Surfaced separately from the checklist: this one has a fix attached,
      // Choices skipped inside the importer's dialogs. Kept apart from the
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
      // Nested, not flat: a list of bare names says nothing about which folder
      // sits inside which, and two folders at different depths can share one.
      folders: folderChoices(actor.folder?.id ?? null),
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
        //
        // The name counts as done once it is not the placeholder we gave it,
        // which is the same rule the sheet button's count uses.
        const named = hasPlaceholderName(actor) ? 0 : 1;
        const done = steps.filter((step) => step.done).length + named;
        return t("guide.progress", done, steps.length + 1);
      })()
    };
  }

  _onRender() {
    applyTheme(this);
    preserveScroll(this, [".pk5e-pane"]);

    this.bindNameField();
    this.bindOwnership();
    this.bindDisclosures();

    if (!this._hooks.length) this.registerWatchers();

    // the importer's own dialogs leave no trace in the data, so they have to be
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

  /** The name field, saved on blur and on Enter so it sticks either way. */
  bindNameField() {
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
  }

  /** Who owns the character and which folder it sits in. */
  bindOwnership() {
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
        update.name = uniqueActorName(
          player ? `${DEFAULT_NAME} for ${player.name}` : DEFAULT_NAME,
          this.actor.id
        );
        Object.assign(
          update,
          tokenNameUpdate(this.actor, update.name, [DEFAULT_NAME, AUTO_NAME])
        );
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
  }

  /**
   * Remembers which collapsible sections the player left open.
   *
   * ApplicationV2 rebuilds the element on every redraw, and the panel redraws
   * on every completed step, so without this everything springs back open
   * underneath whoever is reading it.
   */
  bindDisclosures() {
    this.element.querySelectorAll("details[data-help]").forEach((node) => {
      node.addEventListener("toggle", () => {
        this._help[node.dataset.help] = node.open;
      });
    });

    const disclaimer = this.element.querySelector(".pk5e-disclaimer");
    if (disclaimer) {
      disclaimer.addEventListener("toggle", () => {
        this._disclaimerOpen = disclaimer.open;
      });
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
    //
    // Not on the compendium route: the panel reads the importer's own list to
    // know what is highlighted, so beside the Compendium Browser it would sit
    // there empty. The browser shows descriptions itself.
    if (
      step === "class" &&
      !usesCompendium(this.actor) &&
      game.settings.get(MODULE_ID, "openReferenceWithClass")
    ) {
      try {
        openImporterPanel();
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not open the panel alongside`, err);
      }
    }

    const pressed = await this.addFor(step);
    if (!pressed) return;

    // THE COMPENDIUM ROUTE ENDS HERE.
    //
    // There is no "Import Complete" window to wait for - the player picks an
    // entry in the browser, dnd5e's Advancement prompts run, and the item
    // lands. The createItem watcher redraws the panel when it does, which is
    // the whole of the ending.
    //
    // Waiting anyway is what this avoids: watchImportEnd() looks for a window
    // belonging to the importer, so on this route it never matched and every
    // step sat marked "importing" for the full two-minute timeout, holding
    // back the skipped-choice check the entire time.
    //
    // Nor is the check held back here. dnd5e's own prompts write their answers
    // into the item's advancement data, so validate.mjs can read what was
    // chosen without anyone having watched it happen.
    if (usesCompendium(this.actor)) {
      this.render();
      return;
    }

    // Marks the step as running until the importer says otherwise. This also
    // holds back the skipped-choice check: the importer puts its dialogs up a
    // moment after the item lands, so checking straight away accuses the player
    // of skipping something they are about to be asked.
    //
    // Ending it used to be guesswork - watch for activity, give up after a
    // quiet spell - and every threshold that stopped it clearing too early made
    // it linger long after the work was done. The importer's own "Import
    // Complete" window settles it.
    this._importing = step;
    this._importCancelled = false;
    this._lastActivity = Date.now();
    this.render();

    try {
      await watchImportEnd({ timeout: 120000 });
    } finally {
      this._importing = null;
      // The sheet settles a moment after the importer reports itself finished.
      await wait(600);
      this.render();
    }
  }

  /** Lets the player set the portrait without hunting for it on the sheet. */
  /** Opens the reading window for classes and subclasses. */
  /** Per-user language switch; does not touch anyone else's view. */
  /** Per-user colour scheme; like the language switch, it changes nobody else's view. */
  static async onSetTheme(event, target) {
    try {
      await game.settings.set(MODULE_ID, "theme", target.dataset.theme);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not change the panel theme`, err);
    }
  }

  /**
   * Records which of the two routes this character is built along.
   *
   * Offered again after it has been answered, rather than asked once and
   * locked: a player who picks the importer and finds their books are not in
   * it needs a way back, and the choice costs nothing to change - it decides
   * what the NEXT step does, not what the last one did. Steps already finished
   * stay exactly as they are.
   */
  static async onSetSource(event, target) {
    const actor = this.actor;
    if (!actor) return;

    await setSource(actor, target.dataset.source);
    this.render();
  }

  static async onSetLanguage(event, target) {
    try {
      await game.settings.set(MODULE_ID, "language", target.dataset.lang);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not change the panel language`, err);
    }
  }

  /** Remembers the folder currently chosen as the destination for new characters. */
  /** Opens the importer's level-up window, which also offers multiclassing. */
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

    // Same reading panel as the class step: adding a second class is exactly the
    // moment a player wants to know what the classes do, and it was only
    // offered the first time round. Skipped on the compendium route for the
    // same reason as there - it has no list to follow.
    if (!usesCompendium(actor) && game.settings.get(MODULE_ID, "openReferenceWithClass")) {
      try {
        openImporterPanel();
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not open the panel alongside`, err);
      }
    }

    // Marked as importing for the same reason the other steps are: the importer
    // puts its choice dialogs up a moment after the class lands, and without
    // this the panel announced a skipped choice while the dialog asking for it
    // was still on its way. Adding a second class went through here, not
    // through onAddStep, so it was missing that protection entirely.
    this._importing = "class";
    this.render();

    try {
      await pressLevelUp(actor);
      await watchImportEnd({ timeout: 120000 });
    } finally {
      this._importing = null;
      // The sheet settles a moment after the importer reports itself finished.
      await wait(600);
      this.render();
    }
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
