/**
 * module.mjs - punkt wejscia modulu.
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
    name: "Domyslna metoda atrybutow",
    hint: "Od tej metody zaczyna sie krok z atrybutami. Gracz moze ja zmienic.",
    scope: "world",
    config: true,
    type: String,
    default: "standard",
    choices: {
      standard: "Zestaw standardowy (15,14,13,12,10,8)",
      pointbuy: "Zakup punktowy (27 pkt)",
      roll: "Rzut koscmi (4k6, odrzuc najnizsza)",
      manual: "Recznie"
    }
  });

  game.settings.register(MODULE_ID, "allowPlayers", {
    name: "Gracze moga otwierac kreator",
    hint: "Gracz musi dodatkowo miec uprawnienie 'Tworzenie nowych Aktorow' w ustawieniach uzytkownikow.",
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

  if (game.system.id !== "dnd5e") {
    ui.notifications.warn(
      "Prosty Kreator Postaci dziala tylko w systemie dnd5e i zostal wylaczony."
    );
  }
});

/** Przycisk w zakladce Aktorzy. */
Hooks.on("renderActorDirectory", (app, html) => {
  if (game.system.id !== "dnd5e") return;
  if (!game.user.isGM && !game.settings.get(MODULE_ID, "allowPlayers")) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".pk5e-launch")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pk5e-launch";
  button.innerHTML = '<i class="fa-solid fa-hat-wizard"></i> Kreator Postaci';
  button.addEventListener("click", () => new CharacterCreator().render(true));

  const target =
    root.querySelector(".header-actions") ??
    root.querySelector(".directory-header") ??
    root;
  target.appendChild(button);
});
