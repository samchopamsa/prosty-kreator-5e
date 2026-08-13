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

Hooks.once("init", () => {
  // Wording shown in the guide panel. Leave blank to use the built-in text.
  const textSettings = {
    introText: "Panel: opening paragraph",
    textSpecies: "Panel: species step",
    textBackground: "Panel: background step",
    textClass: "Panel: class step",
    textAbilities: "Panel: ability scores step",
    textLanguages: "Panel: languages step"
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

  game.settings.register(MODULE_ID, "autoAdvance", {
    name: "Click through the import dialogs automatically",
    hint: "Skips the 'Use Plutonium / Use Compendium Browser' choice and presses 'Open Importer', so players land straight on the list. Recognises those windows by their wording, so an update to Plutonium can stop it working - it then simply does nothing.",
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

  game.settings.register(MODULE_ID, "showStepHelp", {
    name: "Show 'What is this?' explanations",
    hint: "Short plain-language notes on each step, for players new to the game. Open by default on a brand new character.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
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

registerSheetButton();
registerBrowserTweaks();
registerContextMenu();

Hooks.once("ready", () => {
  const api = {
    guide: () => CreationGuide.start(),
    resume: (actorId) => CreationGuide.open(actorId),
    complete: (actorId) => new CompleteCharacter({ actorId }).render(true),
    languages: (actorId) => new LanguagePicker({ actorId }).render(true),
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
