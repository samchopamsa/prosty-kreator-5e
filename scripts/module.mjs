/**
 * module.mjs - module entry point.
 */

import { MODULE_ID } from "./sources.mjs";
import { CharacterCreator } from "./creator.mjs";
import { SourceConfig } from "./source-config.mjs";
import { registerBrowserTweaks } from "./browser-tweaks.mjs";
import { CompleteCharacter } from "./complete.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabledPacks", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.registerMenu(MODULE_ID, "sourcesMenu", {
    name: "Compendium sources",
    label: "Configure sources",
    hint: "Choose which compendiums the character creator reads species, backgrounds and classes from.",
    icon: "fa-solid fa-book",
    type: SourceConfig,
    restricted: true
  });

  game.settings.register(MODULE_ID, "defaultRules", {
    name: "Default rules edition",
    hint: "Which edition the lists are filtered to when the creator opens. Players can still switch.",
    scope: "world",
    config: true,
    type: String,
    default: "2024",
    choices: {
      "": "All editions",
      "2024": "2024 rules only",
      "2014": "2014 rules only"
    }
  });

  game.settings.register(MODULE_ID, "abilityMethod", {
    name: "Default ability score method",
    hint: "Which method the Abilities step starts on. Players can still switch.",
    scope: "world",
    config: true,
    type: String,
    default: "standard",
    choices: {
      standard: "Standard array (15,14,13,12,10,8)",
      pointbuy: "Point buy (27 points)",
      roll: "Roll dice (4d6 drop lowest)",
      manual: "Manual entry"
    }
  });

  game.settings.register(MODULE_ID, "showArtwork", {
    name: "Show artwork in descriptions",
    hint: "Off by default. SRD text links to images from premium modules; without a licence Foundry draws a padlock instead.",
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
    name: "Players may open the creator",
    hint: "Players also need the 'Create New Actors' permission in User Configuration.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

registerBrowserTweaks();

Hooks.once("ready", () => {
  const api = {
    open: () => new CharacterCreator().render(true),
    complete: (actorId) => new CompleteCharacter({ actorId }).render(true),
    sources: () => new SourceConfig().render(true),
    CharacterCreator,
    CompleteCharacter,
    SourceConfig
  };
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = api;
  globalThis.characterCreator = api;
  globalThis.prostyKreator = api;

  if (game.system.id !== "dnd5e") {
    ui.notifications.warn("Character Creator only works with the dnd5e system.");
  }
});

/** Button in the Actors sidebar tab. */
Hooks.on("renderActorDirectory", (app, html) => {
  if (game.system.id !== "dnd5e") return;
  if (!game.user.isGM && !game.settings.get(MODULE_ID, "allowPlayers")) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".pk5e-launch")) return;

  const target =
    root.querySelector(".header-actions") ??
    root.querySelector(".directory-header") ??
    root;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pk5e-launch";
  button.innerHTML = '<i class="fa-solid fa-hat-wizard"></i> Character Creator';
  button.addEventListener("click", () => new CharacterCreator().render(true));
  target.appendChild(button);

  const complete = document.createElement("button");
  complete.type = "button";
  complete.className = "pk5e-launch pk5e-launch-secondary";
  complete.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Complete Character';
  complete.addEventListener("click", () => new CompleteCharacter().render(true));
  target.appendChild(complete);
});
