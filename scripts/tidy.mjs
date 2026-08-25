/**
 * tidy.mjs
 * ---------------------------------------------------------------------------
 * The sheet buttons, registered through Tidy 5e Sheets' own API.
 *
 * WHY A SEPARATE PATH
 * -------------------
 * sheet-button.mjs finds an anchor in the sheet's markup and inserts a button
 * next to it. That works on the dnd5e sheet and does nothing at all on Tidy,
 * whose markup shares none of those anchors - which is why the button was
 * missing on a Tidy world without anything appearing to be wrong.
 *
 * Inserting into Tidy's markup anyway would be worse than useless: it renders
 * with Svelte and rebuilds parts of itself, so an injected element disappears
 * on the next update with no error to explain it.
 *
 * Tidy publishes an API for exactly this. Controls registered through it are
 * rebuilt alongside everything else, and `visible` is re-evaluated on every
 * render, so a label that depends on the character's state stays correct.
 *
 * WHAT IS REGISTERED
 * ------------------
 * Two controls, both with `position: "header"` rather than the default "menu".
 * The menu is behind a three-dot button, and a new player has no reason to open
 * it - a prompt to finish an unfinished character is worth nothing if it is
 * hidden. This is the same reasoning that put the button on the dnd5e header
 * rather than in its context menu.
 *
 * Registration happens on `tidy5e-sheet.ready`, which Tidy documents as the
 * point where the API is guaranteed to exist. Reading it earlier finds nothing.
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";
import { CreationGuide, isIncomplete, missingSteps } from "./guide.mjs";
import { LevelUpGuide } from "./levelup.mjs";

let registered = false;

/**
 * The creation button's wording, which depends on how much is left.
 *
 * A character with nothing done needs an invitation to start; one part-way
 * through needs to be told it can be resumed. The distinction matters to a
 * player who does not yet know the panel exists.
 */
function creationLabel(actor) {
  if (!isIncomplete(actor)) return "Character creation";
  const outstanding = missingSteps(actor)?.length ?? 0;
  return outstanding >= 4 ? "Start creation" : "Resume creation";
}

/** Whether this user may act on this character at all. */
function ownsActor(actor) {
  return Boolean(actor?.isOwner);
}

export function registerTidyControls() {
  if (registered) return;

  Hooks.once("tidy5e-sheet.ready", (api) => {
    if (!api?.registerCharacterHeaderControls) {
      console.warn(`${MODULE_ID} | Tidy is present but its API looks unfamiliar`);
      return;
    }

    try {
      api.registerCharacterHeaderControls({
        controls: [
          {
            icon: "fa-solid fa-hat-wizard",
            label: "Character creation",
            action: `${MODULE_ID}-creation`,
            position: "header",
            ownership: "OWNER",
            // Re-evaluated on every render, so a character finished mid-session
            // stops advertising the panel without the sheet being reopened.
            visible() {
              return ownsActor(this.document);
            },
            async onClickAction() {
              CreationGuide.open(this.document.id);
            }
          },
          {
            icon: "fa-solid fa-arrow-up-right-dots",
            label: "Level up",
            action: `${MODULE_ID}-levelup`,
            position: "header",
            ownership: "OWNER",
            // Hidden on a character that has no class yet: levelling up an
            // empty sheet is not a thing anyone means to do, and the button
            // would only invite a confusing dead end.
            visible() {
              const actor = this.document;
              return ownsActor(actor) && actor.items.some((item) => item.type === "class");
            },
            async onClickAction() {
              LevelUpGuide.open(this.document.id);
            }
          }
        ]
      });

      registered = true;
      trace("Tidy header controls registered");
    } catch (err) {
      console.error(`${MODULE_ID} | Could not register the Tidy header controls`, err);
    }
  });
}

/**
 * Whether Tidy is handling character sheets in this world.
 *
 * Used to keep the two paths from both firing: the dnd5e injection is harmless
 * on a Tidy sheet (it finds no anchor and gives up), but a world that switches
 * back should not end up with one button from each route.
 */
export function tidyHandlesCharacters() {
  const module = game.modules.get("tidy5e-sheet");
  if (!module?.active) return false;

  const sheets = CONFIG.Actor?.sheetClasses?.character ?? {};
  return Object.entries(sheets).some(([id, config]) => config?.default && id.includes("Tidy5e"));
}

/**
 * Whether our controls made it into Tidy's API.
 *
 * Tidy renders the control itself, with its own markup, so looking for our
 * class in the sheet answers nothing on a Tidy world. Registration is the only
 * thing we can honestly assert - and it is what selftest.mjs asks about.
 */
export function tidyControlsRegistered() {
  return registered;
}

/** For the console, when the button is missing and it is not obvious why. */
export function debugTidy() {
  const module = game.modules.get("tidy5e-sheet");
  console.group(`${MODULE_ID} | Tidy`);
  console.log("installed:", !!module, "| active:", !!module?.active, "| version:", module?.version);
  console.log("handles character sheets:", tidyHandlesCharacters());
  console.log("our controls registered:", registered);
  console.groupEnd();
  return { active: !!module?.active, handling: tidyHandlesCharacters(), registered };
}
