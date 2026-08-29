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
import { LanguagePicker, announceRoll, confirmExtraLanguages, filterLanguages } from "./languages.mjs";
import {
  POINT_BUY_TOTAL,
  abilityKeys,
  applyAbilities,
  buildRows,
  isReady,
  newState,
  pointsSpent,
  rollPool,
  setMethod,
  stateFor,
  stepAbility
} from "./abilities-core.mjs";
import {
  applyLanguages,
  buildLanguageView,
  rollLanguage,
  selectionFor
} from "./languages-core.mjs";
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
import { autoPickSingleLevel } from "./level-select.mjs";
import {
  readGains,
  diffGains,
  readLevelBefore,
  recordLevelGains,
  clearLevelGains,
  dropLastLevelGain
} from "./gains.mjs";
import { choosePortrait } from "./portrait.mjs";
import { trace } from "./trace.mjs";
import { postSummary } from "./summary.mjs";
import { text, STEP_CONFIG, deleteWithAdvancement, confirmRemoval, grantExperienceFor, pressLevelUp, pressSheetButton, ensureEditMode, restoreSheetMode, wait } from "./sheet-actions.mjs";

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
    // Two columns to fit now, not one, so the cap is higher: the rail takes a
    // fixed slice and what is left has to hold a picture, a name and a wrapped
    // description without them stacking. The floor stays where it was - a small
    // window is still better filled than overflowed.
    const width = Math.min(1120, Math.max(360, vw - 40));
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
    /** Steps the player has folded away. Empty until they fold one. */
    this._folded = {};
    /** Which card is on screen, and the order the rail walks through. */
    this._active = null;
    this._rail = [];
    /** What the sheet mode was before the panel unlocked it, once known. */
    this._priorSheetMode = undefined;
    /** Step whose import is still running, if any. */
    this._importing = null;
    /** Ability scores being assigned on the card, and who they were seeded from. */
    this._abilities = null;
    this._abilitiesFor = null;
    /** Languages being ticked on the card, plus this session's rolls and query. */
    this._languages = null;
    this._languagesFor = null;
    /** What the sheet itself listed last time we looked, to spot what it gained. */
    this._languagesSeen = new Set();
    this._languageRolls = [];
    this._languageQuery = "";
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
    // Only a fallback: the constructor works the real size out from the window
    // it is opening into. Sized for the two columns all the same, so a panel
    // opened before that runs is not a strip.
    position: { width: 900, height: 640 },
    actions: {
      addStep: CreationGuide.onAddStep,
      removeStep: CreationGuide.onRemoveStep,
      redoStep: CreationGuide.onRedoStep,
      delevel: CreationGuide.onDelevel,
      dismissOption: CreationGuide.onDismissOption,
      openSheet: CreationGuide.onOpenSheet,
      finalizeGuide: CreationGuide.onFinalizeGuide,
      setPortrait: CreationGuide.onSetPortrait,
      toggleStep: CreationGuide.onToggleStep,
      goStep: CreationGuide.onGoStep,
      goBack: CreationGuide.onGoBack,
      goNext: CreationGuide.onGoNext,
      abortGuide: CreationGuide.onAbortGuide,
      setDefaultFolder: CreationGuide.onSetDefaultFolder,
      levelUp: CreationGuide.onLevelUp,
      setLanguage: CreationGuide.onSetLanguage,
      setTheme: CreationGuide.onSetTheme,
      abilityPlus: CreationGuide.onAbilityPlus,
      abilityMinus: CreationGuide.onAbilityMinus,
      rollAbilities: CreationGuide.onRollAbilities,
      resetAbilities: CreationGuide.onResetAbilities,
      saveAbilities: CreationGuide.onSaveAbilities,
      rollLanguage: CreationGuide.onRollLanguage,
      clearRolls: CreationGuide.onClearRolls,
      saveLanguages: CreationGuide.onSaveLanguages,
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

    // The portrait is drawn in the first block, beside the name, instead of as
    // a step of its own: it is a picture of the character, and it belongs where
    // the character is named. buildSteps() still returns it - steps.mjs states
    // the rules and knows nothing about this window - so it is taken out here,
    // which also leaves the remaining numbers running 2..6 without renumbering.
    const portraitStep = steps.find((step) => step.key === "portrait");
    steps = steps.filter((step) => step.key !== "portrait");

    // Numbered here, not in steps.mjs, because the portrait leaving the list is
    // this window's decision: numbering there would count a step this panel
    // never draws and the player would be looking for a missing seven.
    steps = steps.map((step, index) => ({ ...step, number: index + 2 }));

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
      step.folded = !!this._folded[step.key];

      // WHERE "ADD A LEVEL" SITS ONCE THERE ARE TWO CLASSES
      //
      // It used to be drawn inside the last entry's own row of links, which is
      // right while there is one class and wrong the moment a second arrives:
      // the offer then sat under Wizard and read as "add a level of Wizard",
      // while the button does no such thing - it opens the importer's level-up,
      // which asks which class itself. Worse, it vanished from under the first
      // class, so the player who had just multiclassed saw the option move.
      //
      // With more than one class it moves out from under any of them, to a row
      // of its own below the group.
      step.groupLevelUp = !!step.levelUp && (step.entries ?? []).length > 1;

      // What the head says once the step is folded. A folded step showing only
      // its own name has hidden the answer, which is the one thing the panel is
      // there to report - so the choice moves up into the heading. Every entry,
      // because a multiclassed character summarised as "Cleric 3" alone would be
      // describing somebody else. Bio has no single choice to name, so it counts
      // the fields that have something in them.
      const chosen = (step.entries ?? []).map((entry) => entry.name).filter(Boolean);
      const bioTotal = step.bio
        ? step.bio.fields.length + step.bio.personality.length + step.bio.notes.length
        : 0;
      step.foldResult = chosen.length
        ? chosen.join(", ")
        : step.bio
          ? t("bio.filledOf", step.bio.filled, bioTotal)
          : step.result || "";

      // ONE LINE PER CLASS, NOT ONE LINE PER STEP
      //
      // The rail is 210-280px wide and its answer was a single line cut with an
      // ellipsis. That is right for one class and wrong for two: the moment a
      // character multiclassed, "Fighter 3 - Champion, Wizard 2 - Evocation"
      // became "Fighter 3 - Champi..." and the second class - the thing that
      // had just been added - was the half that disappeared.
      //
      // So the entries are handed over as a list and the rail draws a row each.
      // The rail is a column; it has height to spend and no width. Every other
      // step has exactly one entry, so nothing else changes shape.
      step.foldLines = chosen.length
        ? chosen
        : step.foldResult
          ? [step.foldResult]
          : [];
    }

    // Once per window, before anything reads the flags: a character made by an
    // older version may still be carrying the old shape of them.
    if (!this._migrated) {
      this._migrated = true;
      migrateActor(actor);
    }

    // FOLDED, ALWAYS, INCLUDING ON A BRAND NEW CHARACTER
    //
    // It used to open itself the first time a character's panel was opened, and
    // fold away afterwards - which put four paragraphs of preamble between the
    // player and the first step at exactly the moment they were trying to
    // start. The summary line says what is behind it, and anyone who wants it
    // opens it.
    //
    // Opened by hand it stays open for the rest of the session: the toggle
    // writes to `_disclaimerOpen`, and only the initial value is decided here.
    // The `disclaimerSeen` flag is no longer written - nothing reads it now,
    // and characters that carry it are left alone rather than cleaned up.
    if (this._disclaimerOpen === undefined) this._disclaimerOpen = false;

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
    const failures = report.checks.filter((check) => !check.ok);
    // Read once here: the first card counts as done when the character is no
    // longer called "New Character", and both the rail and the findings below
    // ask the same question.
    const named = !hasPlaceholderName(actor);

    // EACH FINDING UNDER THE STEP THAT CAN FIX IT
    //
    // Every check carries the step it belongs to (validate.mjs), so "no
    // languages" is shown on the languages step rather than in a list at the
    // bottom that named a step the player then had to go and find.
    //
    // Only once the step is done, and never while its import is running. Both
    // halves matter: an untouched step reporting "no class" is telling the
    // player what the step is FOR as though it were a fault, and the importer
    // fills a character in over several seconds, so a check run mid-import
    // reports gaps that are about to fill themselves.
    for (const step of steps) {
      const settled = step.done && this._importing !== step.key;
      step.failures = settled ? failures.filter((check) => check.step === step.key) : [];
    }
    const startFailures = named ? failures.filter((check) => check.step === "start") : [];

    // WHICH CARD IS ON SCREEN
    //
    // One step at a time, so the rail down the left is the whole of the
    // navigation. That means the panel has to open somewhere sensible rather
    // than at the top every time: the first thing not yet done, which on a new
    // character is Start and on a half-finished one is where the player left
    // off. Once a card has been picked by hand that choice stands, including
    // when the sheet changes underneath - a redraw that moved the player to
    // another step mid-typing would be unusable.
    //
    // "start" is the name-and-portrait block and "report" is the summary, and
    // neither is one of buildSteps()' steps: steps.mjs states the rules of
    // character creation, and neither naming a character nor reading a
    // checklist is one of them. They are this window's own first and last
    // cards, the same way the portrait leaving the list is this window's
    // decision.
    this._rail = ["start", ...steps.map((step) => step.key), "report"];
    const isDone = (key) => {
      if (key === "start") return named;
      if (key === "report") return report.ready;
      return !!steps.find((step) => step.key === key)?.done;
    };

    if (!this._active || !this._rail.includes(this._active)) {
      this._active = this._rail.find((key) => !isDone(key)) ?? this._rail.at(-1);
    }
    const activeAt = this._rail.indexOf(this._active);
    for (const step of steps) step.active = step.key === this._active;

    // THE TWO STEPS ANSWERED HERE RATHER THAN IN A WINDOW
    //
    // Ability scores and languages are the only steps whose question is ours to
    // ask - every other one hands over to the sheet's own button and lets the
    // system run. They used to each open a window on top of the panel, which in
    // a one-card-at-a-time layout is a second place to look for the same
    // question, and a window the player then has to find and close.
    //
    // Built only for the card actually on screen: both walk the whole language
    // list or every ability, and doing that for steps nobody is looking at is
    // work per render for nothing.
    //
    // The sums and the writing are NOT here. They come from abilities-core.mjs
    // and languages-core.mjs, which the two windows still use - so point buy is
    // costed in one place whichever surface asked for it.
    for (const step of steps) {
      if (!step.active) continue;
      if (step.key === "abilities") step.abilityPick = this.abilityContext(actor);
      if (step.key === "languages") step.langPick = this.languageContext(actor);
    }

    return {
      actorName: actor.name,
      actorImg: actor.img ?? "",
      portrait: actor.img ?? "",
      // Not "has an image": every actor has one. This is buildSteps() own test,
      // which discounts the mystery man and the system placeholders.
      portraitSet: !!portraitStep?.done,
      // The first block used to be marked finished from the moment the panel
      // opened, tick and all, while the character was still called "New
      // Character". Same test the tally uses, so the two cannot disagree.
      nameSet: !hasPlaceholderName(actor),
      portraitBlurb: portraitStep?.blurb ?? "",
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
      // The rail is also where a folded step's answer went. Every entry says
      // what was chosen, so the whole character reads down the left side
      // without opening a single card - which is the thing the fold gave up
      // when it collapsed a step to its name alone.
      rail: [
        {
          key: "start",
          number: 1,
          icon: "fa-signature",
          label: t("step.start"),
          done: named,
          summary: named ? actor.name : "",
          lines: named ? [actor.name] : [],
          active: this._active === "start"
        },
        ...steps.map((step) => ({
          key: step.key,
          number: step.number,
          icon: step.icon,
          label: step.label,
          done: step.done,
          optional: step.optional,
          // A step carrying a finding is marked in the rail the same way a
          // skipped choice is: the player should not have to open every card to
          // learn that one of them has something wrong with it.
          hasSkipped: step.hasSkipped || step.failures.length > 0,
          // Both: the string is the row's hover title, one line being right
          // there, and the list is what the row actually draws.
          summary: step.foldResult,
          lines: step.foldLines,
          active: step.active
        })),
        {
          key: "report",
          number: steps.length + 2,
          icon: "fa-clipboard-check",
          label: t("step.report"),
          done: report.ready,
          summary: report.ready ? t("guide.ready") : t("guide.toFix", report.problems),
          lines: [report.ready ? t("guide.ready") : t("guide.toFix", report.problems)],
          active: this._active === "report"
        }
      ],
      startActive: this._active === "start",
      reportActive: this._active === "report",
      reportNumber: steps.length + 2,
      // The findings that belong to the first card rather than to a step: the
      // portrait, which is set beside the name. Held back until the character
      // has been named, so an untouched panel does not open on a complaint.
      startFailures,
      canBack: activeAt > 0,
      canNext: activeAt >= 0 && activeAt < this._rail.length - 1,
      // The last card is the summary, so the button that ends the process lives
      // there, in place of the one that walks away from it - next to the list
      // of what is still wrong, which is what the decision to finalise is
      // actually made against.
      isLast: activeAt === this._rail.length - 1,
      allDone: steps.every((step) => step.done || step.optional),
      progress: (() => {
        // Every step in the list is counted, optional ones included, because
        // the intro promises six and the numbering shows six. The portrait is
        // not among them any more: it is drawn inside the first block, so it is
        // counted the way that block is - by the name being set.
        //
        // The name counts as done once it is not the placeholder we gave it,
        // which is the same rule the sheet button's count uses.
        const named = hasPlaceholderName(actor) ? 0 : 1;
        const done = steps.filter((step) => step.done).length + named;
        return t("guide.progress", done, steps.length + 1);
      })(),
      // The same tally as a width, for the footer bar. Rounded, because a bar
      // three pixels tall cannot show the difference a fraction would make.
      progressPct: (() => {
        const named = hasPlaceholderName(actor) ? 0 : 1;
        const done = steps.filter((step) => step.done).length + named;
        return Math.round((done / (steps.length + 1)) * 100);
      })()
    };
  }

  _onRender() {
    applyTheme(this);
    this.unlockSheet();
    preserveScroll(this, [".pk5e-pane", ".pk5e-rail"]);

    this.bindNameField();
    this.bindBioFields();
    this.bindOwnership();
    this.bindDisclosures();
    this.bindInlineChoices();

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

  /**
   * The bio fields, saved to the character as they are left.
   *
   * Same rule as the name field above: written on blur, and on Enter for the
   * single-line ones so it sticks even while the field keeps focus. Nothing is
   * written unless the value actually changed - a player who tabs through the
   * form without typing leaves no update behind, and no re-render either.
   *
   * The fields dnd5e stores as HTML are rebuilt as paragraphs from what was
   * typed, with the text escaped first. A biography is prose that a player may
   * well write an angle bracket into, and prose is not markup.
   */
  bindBioFields() {
    const toHtml = (value) => {
      if (!value) return "";
      const escaped = value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return escaped
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
        .join("");
    };

    for (const field of this.element.querySelectorAll("[data-bio]")) {
      const save = async (ev) => {
        const element = ev.currentTarget;
        const path = element.dataset.bio;
        if (!path || !this.actor) return;

        const typed = element.value.trim();
        const value = element.dataset.rich ? toHtml(typed) : typed;
        const current = foundry.utils.getProperty(this.actor, path) ?? "";
        if (String(current) === String(value)) return;

        try {
          await this.actor.update({ [path]: value });
        } catch (err) {
          console.warn(`${MODULE_ID} | Could not save ${path}`, err);
        }
      };

      field.addEventListener("change", save);
      if (field.tagName === "INPUT") {
        field.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            save(ev);
          }
        });
      }
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

  /**
   * Unlocks the character sheet for as long as the panel is open.
   *
   * Not a convenience: on Tidy the "Add Background" button does not exist in
   * play mode at all, so the step did nothing and explained nothing. The panel
   * drives the sheet's own buttons, which means the sheet has to be in the
   * state where those buttons exist.
   *
   * Runs on every render and gives up immediately once it has an answer - the
   * sheet is usually already open behind the panel, but it may be opened later,
   * and this catches up either way.
   */
  async unlockSheet() {
    if (this._priorSheetMode !== undefined) return;
    if (!this.actor?.sheet?.rendered) return;
    try {
      this._priorSheetMode = await ensureEditMode(this.actor);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not unlock the sheet`, err);
    }
  }

  async close(options) {
    // Back to reading mode, unless the player had it unlocked before we did.
    // An undefined prior mode means the panel never saw the sheet open, and the
    // restore treats that as "it was locked" - the state a player who never
    // touches the toggle expects to find.
    try {
      await restoreSheetMode(this.actor, this._priorSheetMode);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not restore the sheet mode`, err);
    }

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
        // Including the card of what it added. Removing one of two classes is
        // the awkward case: the recording covers both, so what is left would be
        // a card listing features the character no longer has. Losing the card
        // is better than keeping a wrong one - taking the class again writes a
        // fresh one anyway.
        await this.clearGains(step);
        // And the levels taken on top of it. Those are recorded as a flat list
        // with no class attached to each entry, so there is no honest way to
        // keep the ones belonging to a class that is staying - and a list of
        // levels under a class that has gone is a card describing somebody
        // else. Levelling again records them afresh.
        if (step === "class") await clearLevelGains(this.actor);
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

    // Armed before the button, because the screen it waits for is one the
    // button brings up. Not awaited: it resolves when that screen has been
    // answered, which is in the middle of the import, not before it.
    if (step === "class") this.armSingleLevel();

    // Read before the button is pressed, not after: everything the importer
    // does from here on is what this step will be credited with.
    const before = readGains(this.actor);

    const pressed = await this.addFor(step);
    if (!pressed) return;

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
      await this.recordGains(step, before);
      this.render();
    }
  }

  /**
   * Writes down what the step just added, for the card under its heading.
   *
   * In `finally`, so a cancelled or half-finished import still records what
   * actually landed - the panel's whole job is reporting the sheet as it is,
   * not as the importer intended it. diffGains() returns null when nothing
   * changed, and then nothing is written: an empty card would be a claim that
   * the step gave nothing, which is not the same as having no recording.
   */
  async recordGains(step, before) {
    const actor = this.actor;
    if (!actor || !before) return;

    try {
      const record = diffGains(before, readGains(actor));
      if (!record) return;
      // Cleared first, then written. An update MERGES what is already there, so
      // writing straight over an earlier recording would leave that one's
      // ability bonuses and coins behind - a class removed and taken again
      // would show what both of them gave.
      await this.clearGains(step);
      await actor.setFlag(MODULE_ID, "gains", { [step]: record });
    } catch (err) {
      // Never worth interrupting creation over: the card is a nicety, the
      // character is not.
      console.warn(`${MODULE_ID} | Could not record what the ${step} step added`, err);
    }
  }

  /**
   * Forgets what a step added. The "-=" prefix is Foundry's own way of saying
   * "remove this key" rather than "merge nothing into it".
   */
  async clearGains(step) {
    const actor = this.actor;
    if (!actor?.getFlag(MODULE_ID, "gains")?.[step]) return;

    try {
      await actor.update({ [`flags.${MODULE_ID}.gains.-=${step}`]: null });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not clear what the ${step} step added`, err);
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
    // offered the first time round.
    if (game.settings.get(MODULE_ID, "openReferenceWithClass")) {
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

    // One level per press here as well. Adding a level and multiclassing both
    // arrive at the same screen, and taking several at once costs the same
    // dialogs it costs on the class step.
    this.armSingleLevel();

    // Read before the button is pressed, exactly as a step is. The level-up
    // window has always reported what a level brought; pressing the button from
    // here recorded nothing at all, so a character levelled from the panel had
    // a step card for level 1 and silence above it.
    const before = readLevelBefore(actor);

    try {
      await pressLevelUp(actor);
      await watchImportEnd({ timeout: 120000 });
    } finally {
      this._importing = null;
      // The sheet settles a moment after the importer reports itself finished.
      await wait(600);
      await recordLevelGains(actor, before);
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

  /**
   * The portrait screen: upload a file, or paste a link. See portrait.mjs for
   * why this is not Foundry's own file browser any more.
   */
  static async onSetPortrait() {
    const actor = this.actor;
    if (!actor) return;
    if (await choosePortrait(actor)) this.render();
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
      // Same reasoning for the card of what that level brought: one press of
      // the importer's button is one level, so undoing one drops one entry.
      await dropLastLevelGain(actor);
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

  /**
   * Folds a step away, or opens it again.
   *
   * Nothing folds on its own: a step the player has not touched is always open,
   * because the panel's job is to show what was chosen - the picture from the
   * importer included - and a list that hides that by default is a list of
   * headings. Folding is here for a long multiclassed panel, and it is the
   * player who decides when that is.
   *
   * The state lives on the window rather than the actor: it is how one person
   * is reading the panel at this moment, not something about the character.
   */
  static onToggleStep(event, target) {
    const key = target.dataset.step;
    if (!key) return;
    this._folded[key] = !this._folded[key];
    this.render();
  }

  /**
   * Moves to another card. The rail holds the order, built with the steps, so
   * back and forward do not need a second list that could disagree with it.
   */
  goTo(key) {
    if (!key || key === this._active) return;
    this._active = key;
    this.render();
  }

  static onGoStep(event, target) {
    this.goTo(target.dataset.step);
  }

  static onGoBack() {
    this.goTo(this._rail[this._rail.indexOf(this._active) - 1]);
  }

  static onGoNext() {
    this.goTo(this._rail[this._rail.indexOf(this._active) + 1]);
  }

  /**
   * Walks away from the panel without finishing.
   *
   * Nothing is undone: whatever reached the character sheet stays on it, which
   * is the only honest meaning of "stop" in a creator that presses the sheet's
   * own buttons. The panel comes back from the sheet button or from
   * characterCreator.resume(), and opens on the first step still outstanding.
   */
  static async onAbortGuide() {
    await this.close();
  }

  /** Ends the guided run: opens the finished sheet and closes the panel. */
  static onFinalizeGuide() {
    const actor = this.actor;
    this.close();
    actor?.sheet.render(true);
  }

  /* ------------------------------------------------------------------ */
  /* Ability scores and languages, chosen on the card                     */
  /* ------------------------------------------------------------------ */

  /**
   * The assignment being worked on, seeded from the character the first time.
   *
   * Held on the window rather than written as it is typed: an assignment is
   * only half an answer until every score has one, and writing halves of it to
   * the sheet would leave a character that reads as finished when it is not.
   * Re-seeded when the panel is pointed at a different character.
   */
  abilityState(actor) {
    if (!this._abilities || this._abilitiesFor !== (actor?.id ?? null)) {
      this._abilities = stateFor(actor);
      this._abilitiesFor = actor?.id ?? null;
    }
    return this._abilities;
  }

  /** Read per render: it is a world setting, so it can change under the panel. */
  get bonusMode() {
    return game.settings.get(MODULE_ID, "bonusMode") ?? "advancements";
  }

  abilityContext(actor) {
    const state = this.abilityState(actor);
    const method = state.method;
    return {
      isStandard: method === "standard",
      isRoll: method === "roll",
      isPointBuy: method === "pointbuy",
      isManual: method === "manual",
      usesPool: method === "standard" || method === "roll",
      rows: buildRows(actor, state, this.bonusMode),
      pointsLeft: POINT_BUY_TOTAL - pointsSpent(state),
      pointsTotal: POINT_BUY_TOTAL,
      canApply: isReady(state, actor)
    };
  }

  /** The ticks being made, seeded from what the sheet already knows. */
  languageState(actor) {
    if (!this._languages || this._languagesFor !== (actor?.id ?? null)) {
      this._languages = selectionFor(actor);
      this._languagesFor = actor?.id ?? null;
      this._languageRolls = [];
      this._languagesSeen = new Set(this._languages);
    }

    // A language the sheet has gained since - a background granting one, most
    // likely, since the panel stays open across every import - is ticked here
    // too. Only the ones that are NEW to the sheet, which is what the second set
    // is for: unioning the whole sheet on every render would put back a tick the
    // player had just taken off, over and over.
    const known = new Set(actor?.system?.traits?.languages?.value ?? []);
    for (const key of known) {
      if (!this._languagesSeen.has(key)) this._languages.add(key);
    }
    this._languagesSeen = known;

    return this._languages;
  }

  languageContext(actor) {
    return {
      ...buildLanguageView(this.languageState(actor), this._languageRolls, {
        standard: t("lang.standard"),
        expanded: t("lang.expanded")
      }),
      query: this._languageQuery
    };
  }

  /**
   * The controls that are not buttons: radios, selects, number fields, ticks.
   *
   * Every one of them re-renders, which is what keeps the arithmetic column
   * honest as the assignment changes. The search box is the exception - it
   * filters the rows in place, because a render would put an empty box back
   * under the cursor mid-word.
   */
  bindInlineChoices() {
    const el = this.element;

    el.querySelectorAll("[data-method]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        setMethod(this.abilityState(this.actor), ev.currentTarget.dataset.method);
        this.render();
      });
    });

    el.querySelectorAll("select[data-assign]").forEach((sel) => {
      sel.addEventListener("change", (ev) => {
        const raw = ev.currentTarget.value;
        this.abilityState(this.actor).assign[ev.currentTarget.dataset.assign] =
          raw === "" ? null : Number(raw);
        this.render();
      });
    });

    el.querySelectorAll("input[data-manual]").forEach((input) => {
      input.addEventListener("change", (ev) => {
        const value = Math.min(20, Math.max(1, Number(ev.currentTarget.value) || 10));
        this.abilityState(this.actor).direct[ev.currentTarget.dataset.manual] = value;
        this.render();
      });
    });

    el.querySelectorAll("input[data-language]").forEach((cb) => {
      cb.addEventListener("change", (ev) => {
        const selected = this.languageState(this.actor);
        const key = ev.currentTarget.dataset.language;
        if (ev.currentTarget.checked) selected.add(key);
        else selected.delete(key);
        this.render();
      });
    });

    const search = el.querySelector("[data-language-search]");
    if (search) {
      // Re-applied after every render, not only when typed into: ticking a
      // language redraws the list, and a filter that quietly reset itself would
      // hand back the full list of every language the system knows.
      if (this._languageQuery) filterLanguages(el, this._languageQuery);
      search.addEventListener("input", (ev) => {
        this._languageQuery = ev.currentTarget.value;
        filterLanguages(el, this._languageQuery);
      });
    }
  }

  static onAbilityPlus(event, target) {
    stepAbility(this.abilityState(this.actor), target.dataset.ability, 1);
    this.render();
  }

  static onAbilityMinus(event, target) {
    stepAbility(this.abilityState(this.actor), target.dataset.ability, -1);
    this.render();
  }

  static async onRollAbilities() {
    const state = this.abilityState(this.actor);
    state.pool = await rollPool();
    state.method = "roll";
    for (const key of abilityKeys()) state.assign[key] = null;
    ui.notifications.info(`Rolled: ${state.pool.join(", ")}`);
    this.render();
  }

  static onResetAbilities() {
    const method = this.abilityState(this.actor).method;
    this._abilities = newState();
    this._abilities.method = method;
    this.render();
  }

  static async onSaveAbilities() {
    const actor = this.actor;
    if (!actor) {
      ui.notifications.warn("That character no longer exists.");
      return;
    }
    try {
      if (!(await applyAbilities(actor, this.abilityState(actor), this.bonusMode))) return;
      ui.notifications.info(`Updated "${actor.name}".`);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not update actor`, err);
      ui.notifications.error(`Character Creator: ${err.message}`);
    }
  }

  static async onRollLanguage() {
    const result = await rollLanguage(this.languageState(this.actor));
    this._languageRolls.push(result.total);
    announceRoll(result);
    this.render();
  }

  static onClearRolls() {
    this._languageRolls = [];
    this.render();
  }

  static async onSaveLanguages() {
    const actor = this.actor;
    if (!actor) {
      ui.notifications.warn("That character no longer exists.");
      return;
    }
    const selected = this.languageState(actor);
    if (!(await confirmExtraLanguages(selected))) return;
    try {
      await applyLanguages(actor, selected);
      ui.notifications.info(`Languages saved for "${actor.name}".`);
      this.render();
    } catch (err) {
      console.error(`${MODULE_ID} | Could not save languages`, err);
      ui.notifications.error(`Could not save languages: ${err.message}`);
    }
  }

  /**
   * Starts watching for the importer's level screen, to answer it with one
   * level. Nothing is awaited: the answer happens part-way through an import
   * this panel is already waiting on, and a failure here must not stop it.
   */
  armSingleLevel() {
    if (!game.settings.get(MODULE_ID, "singleLevelPerImport")) return;
    autoPickSingleLevel().catch((err) =>
      console.warn(`${MODULE_ID} | Could not watch for the level screen`, err)
    );
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
