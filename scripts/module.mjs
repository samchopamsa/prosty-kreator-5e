/**
 * module.mjs - module entry point.
 *
 * The module guides character creation through the tools already installed:
 * the dnd5e character sheet, its Advancement system, and importers. It adds the ordering and the one thing importers skip - ability
 * scores - rather than reimplementing anything.
 */

import { MODULE_ID } from "./constants.mjs";
import { CreationGuide } from "./guide.mjs";
import { CompleteCharacter } from "./complete.mjs";
import { LanguagePicker } from "./languages.mjs";
import { registerSheetButton } from "./sheet-button.mjs";
import { registerTidyControls, debugTidy } from "./tidy.mjs";
import { registerBrowserTweaks } from "./browser-tweaks.mjs";
import { registerContextMenu } from "./context-menu.mjs";
import { registerTranslationHelper, LANGUAGE_CHOICES } from "./i18n.mjs";
import { ClassReference } from "./reference.mjs";
import { ImporterPanel, openImporterPanel } from "./importer-panel.mjs";
import { startHostWatch } from "./dock.mjs";
import { debugActor, debugCompendiums, debugStamps } from "./debug.mjs";
import { debugRules, debugVerify } from "./rules-data.mjs";
import { debugFluff } from "./class-text.mjs";
import { startTokenNameSync } from "./naming.mjs";
import { LevelUpGuide, openLevelUp } from "./levelup.mjs";
import { selfTest, captureImporter, captureDialog } from "./selftest.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "defaultLanguage", {
    name: "Panel language",
    hint: "Language of the creation panel, the ability score window and the language window. Players can override this for themselves. Settings, compendium screens and imported content stay in English.",
    scope: "world",
    config: true,
    type: String,
    default: "en",
    choices: LANGUAGE_CHOICES
  });

  game.settings.register(MODULE_ID, "language", {
    scope: "client",
    config: false,
    type: String,
    default: "auto"
  });

  // Wording shown in the guide panel. Leave blank to use the built-in text.
  const textSettings = {
    introText: "Panel: opening paragraph",
    textSpecies: "Panel: species step",
    textBackground: "Panel: background step",
    textClass: "Panel: class step",
    textAbilities: "Panel: ability scores step",
    textLanguages: "Panel: languages step",
    textPortrait: "Panel: portrait step",
    textBio: "Panel: bio step"
  };
  for (const [key, name] of Object.entries(textSettings)) {
    game.settings.register(MODULE_ID, key, {
      name,
      hint: "Your own wording for this step. Leave blank for the default.",
      scope: "world",
      config: true,
      type: String,
      default: ""
    });
  }






  // Was five settings: a mode and a source-screen toggle for players, the same
  // pair for the GM, and a switch for the Keep Window Open checkbox. Their own
  // help text pointed at the importer's "Use Importer when Using ADD ... Button"
  // as the better answer, which it is - so what remains is the fallback for
  // tables that have not set it.
  game.settings.register(MODULE_ID, "autoAdvance", {
    name: "Click through the importer's opening screens",
    hint:
      "The importer asks which tool to use and which books to read before it shows anything. " +
      "This answers both, so a step goes straight to the list. Better still, set the importer's " +
      "'Use Importer when Using ADD ... Button on Actor' to Always - then it never asks and " +
      "this is unnecessary.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      off: "Leave the screens alone",
      players: "Click through for players only",
      everyone: "Click through for everyone"
    },
    // Players get walked past it, the GM does not. The screen asks which books
    // to read out of a list of fifteen source codes - a question the GM has an
    // opinion about and a player has no way to answer, and it stands between
    // them and the class list every single time. The GM keeps it because
    // narrowing the books is a thing they actually do.
    default: "players"
  });

  game.settings.register(MODULE_ID, "openReferenceWithClass", {
    name: "Show class descriptions beside the importer",
    hint: "The importer lists class names with nothing to read. This opens a narrow panel next to it that follows along: click a class or subclass in the importer and its description appears in the panel. When an entry is not in your compendiums the panel offers a list to pick from instead. The wide reference window is unaffected and stays available from the class step.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "bonusMode", {
    name: "How existing ability score increases are recognised",
    hint: "Backgrounds raise ability scores, so the sheet shows a result rather than the base you assign. This decides how the module works out how much of the score is a bonus. Advancements is the most robust: it reads the increases declared on the character's own items and ignores whatever is on the sheet, which also clears increases left behind when an importer deleted an item.",
    scope: "world",
    config: true,
    type: String,
    default: "advancements",
    choices: {
      advancements: "Read from the character's advancements (recommended)",
      measured: "Measure against the base saved last time",
      none: "Ignore - write the assigned numbers exactly"
    }
  });

  // Defaults to experience, not milestone, because the milestone setting is
  // what a stuck multiclass looks like: dnd5e refuses to advance a character
  // that has not earned the level, so the panel announced "the import is
  // starting" and then nothing happened at all - no error, no window, and no
  // way to tell from the panel that the button had simply declined. Topping the
  // experience up first costs a milestone table nothing: experience it does not
  // use gets a number in it.
  game.settings.register(MODULE_ID, "levelUpMode", {
    name: "How levelling works at your table",
    hint: "Experience: the character's experience is topped up to the next level before the level-up button is pressed, so the system does not refuse it. Milestone: the button is pressed straight away, which needs the system's own Leveling Mode set to milestone or the press is silently blocked.",
    scope: "world",
    config: true,
    type: String,
    default: "xp",
    choices: {
      xp: "Experience - top it up to the next level first (recommended)",
      milestone: "Milestone - press the button as it is"
    }
  });


  // Intrusive enough to be switchable: it presses OK on somebody else's window.
  // On by default all the same, because the alternative is a screen that lets
  // the player take five levels at once and then silently skips the choices
  // those levels would have asked for - a subclass, most visibly.
  game.settings.register(MODULE_ID, "singleLevelPerImport", {
    name: "Take one level at a time",
    hint:
      "The importer's level screen lets several levels be ticked at once, and then runs them as a " +
      "batch without asking for the choices they carry - a subclass, a fighting style. With this " +
      "on, the panel ticks the next level only and confirms the screen, so every level goes " +
      "through its own dialogs. Add further levels with the level-up button.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "showStepHelp", {
    name: "Show 'What is this?' explanations",
    hint: "Short plain-language notes on each step, for players new to the game. Open by default on a brand new character.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "referencePacks", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // OFF THE SETTINGS SCREEN, NOT DELETED
  //
  // The creator does not build characters out of compendiums any more - that
  // route was dropped and left to modules that do it properly - so a pair of
  // settings about which compendiums to read was asking the GM to configure
  // something the creator no longer does. Both stay registered, because the
  // reference window still honours them and someone's world still has values in
  // them; they are simply no longer offered.
  //
  // The chooser itself is still reachable from the reference window's own
  // button, which is where it belongs: beside the thing it configures.
  game.settings.register(MODULE_ID, "referenceGmSeesAll", {
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  // Stored as a plain id and chosen in the panel, where the folder list is
  // always current. Registering it with a list of choices meant registering
  // after startup, and settings added then do not reliably reach the UI.
  game.settings.register(MODULE_ID, "defaultActorFolder", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "guideButton", {
    name: "Show 'New Character' in the Actors sidebar",
    hint: "Guided creation that drives the character sheet's own buttons.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "sheetButton", {
    name: "Show buttons on the character sheet",
    hint: "Adds 'Complete Character', and 'Resume creation' while anything is outstanding, to the sheet header in edit mode.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoOpenGuide", {
    name: "Open the panel automatically for players",
    hint: "Opens once, the first time a player opens an unfinished character. Closing it stops it coming back.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });


  game.settings.register(MODULE_ID, "narrowBrowserTooltips", {
    name: "Narrow tooltips in the Compendium Browser",
    hint: "Shows the item preview only when hovering the name or icon, so the popup stops covering the selection checkbox. Adjusts another package's interface, so switch it off if anything looks wrong.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "allowPlayers", {
    name: "Players may start a new character",
    hint: "Players also need the 'Create New Actors' permission in User Configuration.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

registerTranslationHelper();
// Two routes to the same buttons, one per sheet.
//
// The dnd5e route inserts into the sheet's markup; Tidy renders with Svelte
// and shares none of those anchors, so on a Tidy world it quietly found
// nothing - which is how the sheet button came to be missing with no error to
// explain it. Tidy publishes an API for this and it is used instead.
//
// Both are started: registration is cheap, each does nothing when its sheet is
// not in use, and a world that switches between them needs no further change.
registerSheetButton();
registerTidyControls();
registerBrowserTweaks();
registerContextMenu();

Hooks.once("ready", () => {
  // Hidden: this is for working out why something did or did not happen, not a
  // knob for the table. Turned on from the console via setDebug().
  game.settings.register(MODULE_ID, "debug", {
    name: "Log diagnostics to the console",
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "levelUpButton", {
    name: "Show the level-up button on the character sheet",
    hint:
      "Opens this module's level-up window: it works through the importer one level at a time, " +
      "reports what the character gained, and notices choice dialogs closed too early. Turn off " +
      "to leave levelling to the sheet's own controls.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "dockImporterPanel", {
    name: "Put the description panel inside the importer",
    hint:
      "The class description panel normally floats beside the importer's importer as a second " +
      "window, which can end up behind something and reads as a separate tool. With this on it " +
      "sits inside the importer, to the right of the list. Turn it off to go back to a movable " +
      "window - useful on a small screen, where two columns leave the list too narrow.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      const open = foundry.applications.instances?.get("pk5e-importer-panel");
      open?.render();
    }
  });

  game.settings.register(MODULE_ID, "hideImporterLevelUp", {
    name: "Hide the importer's own level-up button",
    hint:
      "the importer's button flashes for attention and players follow it instead of this module's, " +
      "which then cannot report what changed. This hides it with styling only - it stays on the " +
      "sheet where this module can still press it, which is how the level-up window works. Do " +
      "not remove it in the importer's own settings: then there is nothing left to press.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      for (const app of Object.values(ui.windows ?? {})) app.render?.(false);
      document.body.classList.toggle(
        "pk5e-hide-importer-levelup",
        game.settings.get(MODULE_ID, "hideImporterLevelUp")
      );
    }
  });

  // The player's own choice. Hidden from the settings screen because it is set
  // from the panel footer, where they are actually looking at the colours.
  game.settings.register(MODULE_ID, "theme", {
    scope: "client",
    config: false,
    type: String,
    default: "auto"
  });

  document.body.classList.toggle(
    "pk5e-hide-importer-levelup",
    game.settings.get(MODULE_ID, "hideImporterLevelUp")
  );

  // The panel belongs to the importer's class importer, so it appears with it
  // rather than only when the creation panel's class step opened it.
  if (game.settings.get(MODULE_ID, "dockImporterPanel")) startHostWatch(openImporterPanel);

  // prototypeToken.name is copied from the actor once, at creation, and never
  // again - so renaming a character left its token saying "New Character" on
  // every hover.
  startTokenNameSync(["New Character", /^New Character for .+$/, /^New Character \(\d+\)$/]);

  const api = {
    guide: () => CreationGuide.start(),
    resume: (actorId) => CreationGuide.open(actorId),
    complete: (actorId) => new CompleteCharacter({ actorId }).render(true),
    languages: (actorId) => new LanguagePicker({ actorId }).render(true),
    reference: () => new ClassReference().render(true),
    importerPanel: () => openImporterPanel(),
    levelUp: (actorId) => openLevelUp(actorId),
    debug: (actorId) => debugActor(actorId),
    debugCompendiums: () => debugCompendiums(),
    // Czy przedmioty na karcie nosza stemple importera - od tego zalezy, czy
    // porownanie z regulami dopasowuje po hashu, czy schodzi do nazw.
    stamps: (actorId) => debugStamps(actorId),
    rules: (className, level, options) => debugRules(className, level, options),
    fluff: (kind, name) => debugFluff(kind, name),
    tidy: () => debugTidy(),
    // Diagnostyka cudzego markupu. selfTest() mowi, czy nasze zaczepienia
    // jeszcze trzymaja; captureImporter() zgrywa okno importera na fixture,
    // zeby tests/markup.mjs opieral sie na prawdziwym markupie, a nie na
    // naszym wyobrazeniu o nim.
    selfTest: () => selfTest(),
    captureImporter: (options) => captureImporter(options),
    captureDialog: () => captureDialog(),
    verify: (actorRef, className, level, options) => debugVerify(actorRef, className, level, options),
    setDebug: (on = true) => {
      game.settings.set(MODULE_ID, "debug", !!on);
      return `${MODULE_ID} | diagnostics ${on ? "on" : "off"}`;
    },
    CreationGuide,
    CompleteCharacter,
    ImporterPanel,
    LevelUpGuide
  };
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = api;
  globalThis.characterCreator = api;

  if (game.system.id !== "dnd5e") {
    ui.notifications.warn("Character Creator only works with the dnd5e system.");
  }
});

/** Whether this user may create actors at all. */
export function canCreateActors() {
  const user = game.user;
  if (!user) return false;
  if (user.isGM) return true;
  if (typeof user.hasPermission === "function") return user.hasPermission("ACTOR_CREATE");
  if (typeof user.can === "function") return user.can("ACTOR_CREATE");
  return false;
}

/** Buttons in the Actors sidebar. */
Hooks.on("renderActorDirectory", (app, html) => {
  if (game.system.id !== "dnd5e") return;
  if (!game.user.isGM && !game.settings.get(MODULE_ID, "allowPlayers")) return;

  // Do not offer character creation to someone who is not allowed to create
  // actors - the button would only ever produce a permission error.
  const showGuide =
    game.settings.get(MODULE_ID, "guideButton") && canCreateActors();
  // "Complete Character" used to sit here too, behind its own setting, as a way
  // in for worlds where the sheet buttons did not appear. That is what
  // characterCreator.complete(actorId) is for, and it does not cost a line on
  // everyone's settings screen.
  if (!showGuide) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".pk5e-launch")) return;

  const target =
    root.querySelector(".header-actions") ??
    root.querySelector(".directory-header") ??
    root;

  const add = (icon, label, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pk5e-launch";
    button.innerHTML = `<i class="fa-solid ${icon}"></i> ${label}`;
    button.addEventListener("click", onClick);
    target.appendChild(button);
  };

  add("fa-hat-wizard", "New Character", () => CreationGuide.start());
});
