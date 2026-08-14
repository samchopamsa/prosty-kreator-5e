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

  game.settings.register(MODULE_ID, "autoAdvanceGm", {
    name: "Click through the import dialogs automatically (GM)",
    hint: "Same as below, but for you. Also better handled by Plutonium's own 'Use Importer when Using ADD ... Button on Actor' setting.",
    scope: "world",
    config: true,
    type: String,
    default: "off",
    choices: {
      off: "Off - you click through",
      plutonium: "Always use Plutonium",
      compendium: "Always use the Compendium Browser"
    }
  });

  game.settings.register(MODULE_ID, "autoAdvance", {
    name: "Click through the import dialogs automatically (players)",
    hint: "Answers the 'Use Plutonium / Use Compendium Browser' question for the player. Better done in Plutonium itself: set 'Use Importer when Using ADD ... Button on Actor' to Always in its Config Editor, and the question stops being asked at all. This setting is then unnecessary and is skipped automatically.",
    scope: "world",
    config: true,
    type: String,
    default: "off",
    choices: {
      off: "Off - the player clicks through",
      plutonium: "Always use Plutonium",
      compendium: "Always use the Compendium Browser"
    }
  });

  game.settings.register(MODULE_ID, "skipSourceScreen", {
    name: "Skip the data source screen (players)",
    hint: "Presses 'Open Importer' for the player, using whatever sources are already ticked. Set those up first in Plutonium's World Data Source Selector, or they will land on an empty list. Works whether or not the setting above is on.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "skipSourceScreenGm", {
    name: "Skip the data source screen (GM)",
    hint: "Same, for you. Leave off if you want to choose sources when importing.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "uncheckKeepOpen", {
    name: "Untick 'Keep Window Open' while clicking through",
    hint: "Only applies when the data source screen is being skipped. That checkbox sits on the screen being skipped, so without this a player who had it ticked could never reach it again.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "openReferenceWithClass", {
    name: "Open the class reference alongside the importer",
    hint: "The importer lists class names with nothing to read. This opens the reading window next to it, so a new player can find out what a Paladin actually does before picking one.",
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

  game.settings.register(MODULE_ID, "showImportingNotice", {
    name: "Show an 'importing' notice while the importer works",
    hint: "Holds the step in an unfinished state until the import windows close. Off by default: detecting that reliably means watching another package's windows, and it tends to either clear too early or linger long after the work is done.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
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

  game.settings.register(MODULE_ID, "sidebarComplete", {
    name: "Also show 'Complete Character' in the sidebar",
    hint: "Fallback if the sheet buttons do not appear on your sheet version.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
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
  const api = {
    guide: () => CreationGuide.start(),
    resume: (actorId) => CreationGuide.open(actorId),
    complete: (actorId) => new CompleteCharacter({ actorId }).render(true),
    languages: (actorId) => new LanguagePicker({ actorId }).render(true),
    reference: () => new ClassReference().render(true),
    CreationGuide,
    CompleteCharacter
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
  const showComplete = game.settings.get(MODULE_ID, "sidebarComplete");
  if (!showGuide && !showComplete) return;

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

  if (showGuide) add("fa-hat-wizard", "New Character", () => CreationGuide.start());
  if (showComplete) {
    add("fa-wand-magic-sparkles", "Complete Character", () =>
      new CompleteCharacter({}).render(true)
    );
  }
});
