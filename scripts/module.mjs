/**
 * module.mjs - module entry point.
 *
 * The module guides character creation through the tools already installed:
 * the dnd5e character sheet, its Advancement system, and importers such as
 * Plutonium. It adds the ordering and the one thing importers skip - ability
 * scores - rather than reimplementing anything.
 */

import { MODULE_ID } from "./constants.mjs";
import { CreationGuide } from "./guide.mjs";
import { CompleteCharacter } from "./complete.mjs";
import { LanguagePicker } from "./languages.mjs";
import { registerSheetButton } from "./sheet-button.mjs";
import { registerBrowserTweaks } from "./browser-tweaks.mjs";
import { registerContextMenu } from "./context-menu.mjs";
import { registerTranslationHelper, LANGUAGE_CHOICES } from "./i18n.mjs";
import { ClassReference } from "./reference.mjs";
import { ImporterPanel, openImporterPanel } from "./importer-panel.mjs";
import { startHostWatch } from "./dock.mjs";
import { debugActor, debugCompendiums } from "./debug.mjs";
import { debugRules, debugVerify } from "./fivetools.mjs";
import { LevelUpGuide, openLevelUp } from "./levelup.mjs";
import { ReferenceConfig } from "./reference-config.mjs";

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
    textPortrait: "Panel: portrait step"
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
  // help text pointed at Plutonium's "Use Importer when Using ADD ... Button"
  // as the better answer, which it is - so what remains is the fallback for
  // tables that have not set it.
  game.settings.register(MODULE_ID, "autoAdvance", {
    name: "Click through the importer's opening screens",
    hint:
      "The importer asks which tool to use and which books to read before it shows anything. " +
      "This answers both, so a step goes straight to the list. Better still, set Plutonium's " +
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
    default: "off"
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

  game.settings.register(MODULE_ID, "levelUpMode", {
    name: "How levelling works at your table",
    hint: "Milestone: the level-up button is pressed straight away. Experience: you are asked which level to reach, experience is topped up to match, and only then does the button run. Match this to the system's own Leveling Mode.",
    scope: "world",
    config: true,
    type: String,
    default: "milestone",
    choices: {
      milestone: "Milestone - no experience needed",
      xp: "Experience - top it up to the chosen level first"
    }
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

  game.settings.register(MODULE_ID, "referenceGmSeesAll", {
    name: "Reference: GM sees every compendium",
    hint: "The compendium selection then applies to players only, so you can read anything while they see a curated set.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.registerMenu(MODULE_ID, "referenceMenu", {
    name: "Reference: compendiums to read",
    label: "Choose compendiums",
    hint: "Which compendiums the class and subclass reference window reads. Leave empty to read them all.",
    icon: "fa-solid fa-book-open",
    type: ReferenceConfig,
    restricted: true
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
registerSheetButton();
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
      "The class description panel normally floats beside Plutonium's importer as a second " +
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

  game.settings.register(MODULE_ID, "hidePlutoniumLevelUp", {
    name: "Hide Plutonium's own level-up button",
    hint:
      "Plutonium's button flashes for attention and players follow it instead of this module's, " +
      "which then cannot report what changed. This hides it with styling only - it stays on the " +
      "sheet where this module can still press it, which is how the level-up window works. Do " +
      "not remove it in Plutonium's own settings: then there is nothing left to press.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => {
      for (const app of Object.values(ui.windows ?? {})) app.render?.(false);
      document.body.classList.toggle(
        "pk5e-hide-plutonium-levelup",
        game.settings.get(MODULE_ID, "hidePlutoniumLevelUp")
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
    "pk5e-hide-plutonium-levelup",
    game.settings.get(MODULE_ID, "hidePlutoniumLevelUp")
  );

  // The panel belongs to Plutonium's class importer, so it appears with it
  // rather than only when the creation panel's class step opened it.
  if (game.settings.get(MODULE_ID, "dockImporterPanel")) startHostWatch(openImporterPanel);

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
    rules: (className, level, options) => debugRules(className, level, options),
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
