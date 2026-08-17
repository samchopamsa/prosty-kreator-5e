/**
 * sheet-button.mjs
 * ---------------------------------------------------------------------------
 * Puts a single button on the character sheet that opens the creation panel.
 * Visible in both play and edit mode: a new player should not have to find the
 * edit toggle before they can build their character.
 *
 * ApplicationV2 fires its render hook under the concrete class name, and the
 * dnd5e sheet class has been renamed across versions, so we listen on every
 * plausible name. Likewise the header markup differs between sheet versions,
 * so we try a list of anchors. If none match, nothing happens - the sidebar
 * fallback and the console command still work.
 *
 * Run this to find the exact name in your world:
 *   game.actors.contents[0].sheet.constructor.name
 */

import { MODULE_ID } from "./constants.mjs";
import { CreationGuide, isIncomplete, missingSteps } from "./guide.mjs";
import { LevelUpGuide } from "./levelup.mjs";
import { LEVEL_UP_SELECTORS } from "./sheet-actions.mjs";

/** Actors whose panel has already been offered in this browser session. */
const OFFERED = new Set();

const SHEET_HOOKS = [
  "renderCharacterActorSheet",
  "renderActorSheet5eCharacter2",
  "renderActorSheet5eCharacter",
  "renderActorSheet5e",
  "renderActorSheet"
];

/**
 * The rest buttons in the sheet header. We insert our button next to them and
 * copy their class list, so it inherits the sheet's own square icon styling
 * instead of us reinventing it.
 */
const REST_SELECTORS = [
  "[data-action='longRest']",
  "[data-action='rest']",
  ".long-rest",
  "[data-tooltip*='Long Rest' i]",
  "[aria-label*='Long Rest' i]",
  "[data-tooltip*='Rest' i]"
];

/** Fallback anchors if no rest button can be found. */
const ANCHORS = [
  ".header-elements",
  ".sheet-header .right",
  ".sheet-header",
  ".window-header",
  ".tab.details",
  ".sheet-body"
];

function inject(app, html) {
  if (!game.settings.get(MODULE_ID, "sheetButton")) return;

  const actor = app.document ?? app.actor;
  if (!actor || actor.type !== "character" || !actor.isOwner) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  root.querySelectorAll(".pk5e-sheet-button").forEach((el) => el.remove());

  const incomplete = isIncomplete(actor);
  const outstanding = missingSteps(actor).length;

  // What the badge counts, and what makes the button pulse.
  //
  // Not the same as what the panel counts. The panel is a checklist and lists
  // the name among its seven; the badge is a mark on someone else's sheet, and
  // a character that is mechanically finished should not carry one because
  // nobody has typed a name over the default. Nothing here stops play.
  const blocking = missingSteps(actor).filter((step) => step !== "name").length;

  // There are two rest buttons (short and long). Take the LAST match so we land
  // to the right of Long Rest rather than between the two.
  let restButton = null;
  for (const selector of REST_SELECTORS) {
    const matches = Array.from(root.querySelectorAll(selector)).filter(
      (el) => el.parentElement
    );
    if (matches.length) {
      restButton = matches[matches.length - 1];
      break;
    }
  }

  const make = (icon, tooltip, onClick) => {
    const el = document.createElement("button");
    el.type = "button";
    el.dataset.tooltip = tooltip;
    el.setAttribute("aria-label", tooltip);
    el.innerHTML = `<i class="fa-solid ${icon}"></i>`;
    el.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return el;
  };

  // One button, one destination. The panel already contains the ability score
  // step, so a second button straight to it only made the player guess which
  // one they wanted. Wording follows the state.
  let label = "Character creation panel";
  if (incomplete) label = outstanding >= 4 ? "Start creation" : "Resume creation";

  // One button that asks, rather than one button per errand.
  //
  // Two buttons made five in that row alongside the rest buttons and
  // Plutonium's, and it wrapped - the experience bar dropped onto the ability
  // scores. Picking one by the character's state instead meant the level-up was
  // simply absent from a character that was playable but still carrying its
  // default name. A short menu costs one click and neither problem.
  const button = make("fa-hat-wizard", label, () => openChooser(actor));

  // A count of what is still outstanding, the way unread messages are counted.
  // Plutonium's own Level Up button flashes gold for attention, and players
  // were following it instead of this one; a number says something that a
  // flashing button cannot, and says it without competing animation.
  if (blocking > 0) {
    const badge = document.createElement("span");
    badge.className = "pk5e-sheet-badge";
    badge.textContent = String(blocking);
    button.appendChild(badge);
  }

  const buttons = [button];

  if (restButton) {
    // Sized like the rest buttons - same square, same spacing - but not styled
    // like them. Copying the class list outright made it disappear into the
    // row, which is the opposite of what a new player needs.
    for (const el of buttons) {
      el.className = restButton.className;
      el.classList.add("pk5e-sheet-button");
      if (blocking > 0 && el === button) el.classList.add("is-unfinished");
    }

    // Same selectors used to press it. The narrower pair missed whichever
    // variant this Plutonium build actually renders, so the button stayed
    // visible even with the setting on.
    const plutonium = LEVEL_UP_SELECTORS.map((sel) => root.querySelector(sel)).find(
      (el) => el && !el.classList.contains("pk5e-sheet-button")
    );

    // Hidden here as well as by the stylesheet. The body class arrives when the
    // setting is read at startup, but a sheet rendered before that - or one
    // Plutonium adds its button to afterwards - kept showing it.
    if (plutonium && game.settings.get(MODULE_ID, "hidePlutoniumLevelUp")) {
      // setProperty with "important", not style.display: Plutonium sets its own
      // display through a class that carries !important, and a plain inline
      // value loses to it.
      plutonium.style.setProperty("display", "none", "important");
    }
    // Into the container that already holds the rest buttons.
    //
    // Measured on a real sheet: div.sheet-header-buttons is 68px wide inside a
    // parent of 232, so a third 30px button fits with room to spare. Every
    // other placement tried - a row of our own, Plutonium's row - wrapped the
    // header and dropped the experience bar onto the ability scores.
    hidePlutoniumButton(root);

    const container = restButton.parentElement;
    if (container) {
      for (const el of buttons) container.appendChild(el);
      return;
    }

    let previous = restButton;
    for (const el of buttons) {
      previous.insertAdjacentElement("afterend", el);
      previous = el;
    }
    return;

  }

  let anchor = null;
  for (const selector of ANCHORS) {
    anchor = root.querySelector(selector);
    if (anchor) break;
  }
  if (!anchor) return;

  for (const el of buttons.reverse()) {
    el.className = "pk5e-sheet-button pk5e-sheet-button-standalone";
      if (blocking > 0 && el === button) el.classList.add("is-unfinished");
    anchor.prepend(el);
  }
}

/**
 * Opens the panel by itself the first time a player opens an unfinished sheet,
 * so nothing has to be found. Strictly once: closing the panel records that on
 * the actor, and it never reappears on its own.
 */
function maybeAutoOpen(actor) {
  if (!game.settings.get(MODULE_ID, "autoOpenGuide")) return;
  if (game.user.isGM) return;
  if (!actor?.isOwner || actor.type !== "character") return;
  if (!isIncomplete(actor)) return;
  if (OFFERED.has(actor.id)) return;
  if (actor.getFlag(MODULE_ID, "guideDismissed")) return;

  OFFERED.add(actor.id);
  setTimeout(() => CreationGuide.open(actor.id), 400);
}

/**
 * Adds the same two entries to the sheet's three-dot menu.
 *
 * A second way in, because the buttons depend on finding a place among someone
 * else's markup and that place has moved once already. The menu is a list -
 * nothing to collide with, nothing to be pushed off the edge of.
 */
/**
 * Asks which of the two the player wants.
 *
 * Both are offered whenever they make sense, rather than one being chosen for
 * them: a character can be worth levelling while the creator still considers it
 * unfinished, and can be worth returning to the creator long after it has been
 * played.
 */
/**
 * Hides Plutonium's own level-up button, if the GM asked for that.
 *
 * Hidden rather than removed: this module levels a character by pressing that
 * button, so it has to stay in the page. A hidden element still receives a
 * programmatic click.
 *
 * setProperty with "important" rather than style.display, because Plutonium
 * sets its display through a class that carries !important, and a plain inline
 * value loses to it.
 */
function hidePlutoniumButton(root) {
  try {
    if (!game.settings.get(MODULE_ID, "hidePlutoniumLevelUp")) return;
    const found = LEVEL_UP_SELECTORS.map((sel) => root.querySelector(sel)).find(
      (el) => el && !el.classList.contains("pk5e-sheet-button")
    );
    found?.style.setProperty("display", "none", "important");
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not hide Plutonium's button`, err);
  }
}

async function openChooser(actor) {
  const hasClass = actor.items.some((i) => i.type === "class");
  const canLevel = hasClass && game.settings.get(MODULE_ID, "levelUpButton");

  if (!canLevel) {
    CreationGuide.open(actor.id);
    return;
  }

  const outstanding = missingSteps(actor).length;
  const creationLabel = outstanding
    ? `Character creation (${outstanding} left)`
    : "Character creation";

  try {
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: actor.name, icon: "fa-solid fa-hat-wizard" },
      // Wide enough for both labels to sit on one line: at the default width
      // the longer one wrapped onto two and the pair looked like a mistake.
      position: { width: 460 },
      classes: ["pk5e-chooser"],
      content: "",
      buttons: [
        { action: "levelup", label: "Level up", icon: "fa-solid fa-arrow-up-right-dots" },
        { action: "creation", label: creationLabel, icon: "fa-solid fa-hat-wizard" }
      ],
      // Dismissing is a real answer here: the player opened the menu, looked,
      // and wants neither.
      rejectClose: false
    });
    if (choice === "levelup") LevelUpGuide.open(actor.id);
    else if (choice === "creation") CreationGuide.open(actor.id);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not offer the choice, opening the creator`, err);
    CreationGuide.open(actor.id);
  }
}

function addHeaderControls(app, controls) {
  const actor = app?.document ?? app?.actor;
  if (!actor || actor.type !== "character" || !actor.isOwner) return;
  if (controls.some((c) => c?.pk5e)) return;

  if (game.settings.get(MODULE_ID, "sheetButton")) {
    controls.push({
      pk5e: true,
      icon: "fa-solid fa-hat-wizard",
      label: isIncomplete(actor) ? "Resume creation" : "Character creation",
      onClick: () => CreationGuide.open(actor.id)
    });
  }

  const hasClass = actor.items.some((i) => i.type === "class");
  if (hasClass && game.settings.get(MODULE_ID, "levelUpButton")) {
    controls.push({
      pk5e: true,
      icon: "fa-solid fa-arrow-up-right-dots",
      label: "Level up",
      onClick: () => LevelUpGuide.open(actor.id)
    });
  }
}

/**
 * Foundry names this hook after the application class, and dnd5e has renamed
 * its sheets between versions, so several are tried - the same approach the
 * render hooks above take.
 */
const HEADER_HOOKS = [
  "getHeaderControlsCharacterActorSheet",
  "getHeaderControlsActorSheet5eCharacter2",
  "getHeaderControlsApplicationV2",
  "getActorSheetHeaderButtons"
];

export function registerSheetButton() {
  for (const hook of HEADER_HOOKS) {
    Hooks.on(hook, (app, controls) => {
      try {
        if (Array.isArray(controls)) addHeaderControls(app, controls);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not add menu entries via ${hook}`, err);
      }
    });
  }

  for (const hook of SHEET_HOOKS) {
    Hooks.on(hook, (app, html) => {
      try {
        inject(app, html);
        maybeAutoOpen(app.document ?? app.actor);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not add the sheet button via ${hook}`, err);
      }
    });
  }
}
