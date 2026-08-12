/**
 * module.mjs - module entry point.
 */

import { MODULE_ID } from "./sources.mjs";
import { CharacterCreator } from "./creator.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "enabledPacks", {
    scope: "world",
    config: false,
    type: Array,
    default: []
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

  game.settings.register(MODULE_ID, "allowPlayers", {
    name: "Players may open the creator",
    hint: "Players also need the 'Create New Actors' permission in User Configuration.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
});

Hooks.once("ready", () => {
  const api = {
    open: () => new CharacterCreator().render(true),
    CharacterCreator
  };
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = api;
  globalThis.prostyKreator = api;
  globalThis.characterCreator = api;

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

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pk5e-launch";
  button.innerHTML = '<i class="fa-solid fa-hat-wizard"></i> Character Creator';
  button.addEventListener("click", () => new CharacterCreator().render(true));

  const target =
    root.querySelector(".header-actions") ??
    root.querySelector(".directory-header") ??
    root;
  target.appendChild(button);
});
