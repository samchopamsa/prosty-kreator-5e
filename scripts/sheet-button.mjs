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

  const button = make("fa-hat-wizard", label, () => CreationGuide.open(actor.id));

  // A count of what is still outstanding, the way unread messages are counted.
  // Plutonium's own Level Up button flashes gold for attention, and players
  // were following it instead of this one; a number says something that a
  // flashing button cannot, and says it without competing animation.
  if (outstanding > 0) {
    const badge = document.createElement("span");
    badge.className = "pk5e-sheet-badge";
    badge.textContent = String(outstanding);
    button.appendChild(badge);
  }

  const buttons = [button];

  // A second button, for a character that is finished and playing. Kept apart
  // from the first: "build this character" and "this character has earned a
  // level" are different errands, and one button doing both would have to guess.
  if (!incomplete && game.settings.get(MODULE_ID, "levelUpButton")) {
    buttons.push(
      make("fa-arrow-up-right-dots", "Level up", () => LevelUpGuide.open(actor.id))
    );
  }

  if (restButton) {
    // Sized like the rest buttons beside it - same square, same spacing - but
    // not styled like them. Copying the class list outright made it disappear
    // into the row, which is the opposite of what a new player needs.
    let previous = restButton;
    for (const el of buttons) {
      el.className = restButton.className;
      el.classList.add("pk5e-sheet-button");
      if (incomplete && el === button) el.classList.add("is-unfinished");
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
    if (incomplete && el === button) el.classList.add("is-unfinished");
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

export function registerSheetButton() {
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
