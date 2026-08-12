/**
 * sheet-button.mjs
 * ---------------------------------------------------------------------------
 * Puts a "Complete Character" button on the character sheet, shown only while
 * the sheet is in edit mode.
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

import { MODULE_ID } from "./sources.mjs";
import { CompleteCharacter } from "./complete.mjs";

const SHEET_HOOKS = [
  "renderCharacterActorSheet",
  "renderActorSheet5eCharacter2",
  "renderActorSheet5eCharacter",
  "renderActorSheet5e",
  "renderActorSheet"
];

/** Anchors tried in order when looking for somewhere to put the button. */
const ANCHORS = [
  ".header-elements",
  ".sheet-header .right",
  ".sheet-header",
  ".window-header",
  ".tab.details",
  ".sheet-body"
];

/**
 * Whether the sheet is currently in edit mode.
 * Returns true when we cannot tell, so the button is never silently lost.
 */
function inEditMode(app, root) {
  const MODES = app.constructor?.MODES;
  if (MODES?.EDIT !== undefined && typeof app._mode === "number") {
    return app._mode === MODES.EDIT;
  }
  const toggle = root.querySelector(".mode-slider, [name='mode'], .sheet-mode-toggle");
  if (toggle && "checked" in toggle) return !!toggle.checked;
  return true;
}

function inject(app, html) {
  if (!game.settings.get(MODULE_ID, "sheetButton")) return;

  const actor = app.document ?? app.actor;
  if (!actor || actor.type !== "character" || !actor.isOwner) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  root.querySelector(".pk5e-sheet-button")?.remove();
  if (!inEditMode(app, root)) return;

  let anchor = null;
  for (const selector of ANCHORS) {
    anchor = root.querySelector(selector);
    if (anchor) break;
  }
  if (!anchor) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pk5e-sheet-button";
  button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Complete Character';
  button.dataset.tooltip = "Assign ability scores and languages";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    new CompleteCharacter({ actorId: actor.id }).render(true);
  });

  anchor.prepend(button);
}

export function registerSheetButton() {
  for (const hook of SHEET_HOOKS) {
    Hooks.on(hook, (app, html) => {
      try {
        inject(app, html);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not add the sheet button via ${hook}`, err);
      }
    });
  }
}
