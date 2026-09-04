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
 * Plus the review mark, which is not a control at all. It goes in through
 * `registerCharacterContent`, beside the character's name, because that is
 * where it says something: in the row of action buttons it read as a fifth
 * thing to press. Tidy re-injects registered content on every render, which is
 * the part we could not do from outside. If that API is not there in the shape
 * we read, it falls back to being a control after all.
 *
 * Registration happens on `tidy5e-sheet.ready`, which Tidy documents as the
 * point where the API is guaranteed to exist. Reading it earlier finds nothing.
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";
import { CreationGuide, isIncomplete, missingSteps } from "./guide.mjs";
import { LevelUpGuide } from "./levelup.mjs";
import { reviewBadge, reviewLabel, REVIEW_FACES } from "./review.mjs";

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
/**
 * Where Tidy keeps the character's name, in both of its layouts.
 *
 * Read out of Tidy 13.9.3's own stylesheets rather than guessed: `classic.css`
 * styles `.actor-name` (the cell holding the name, an <input> in edit mode) and
 * `main.css` styles `.actor-name-row` for the newer "quadrone" layout. Only one
 * layout renders at a time, so one selector list matches one element.
 *
 * The Svelte scope classes beside them (.svelte-1kkzh1m and friends) are
 * rebuilt on every Tidy release. These two are not, and they are what Tidy's
 * own rules hang on.
 */
const TIDY_NAME_ANCHOR = ".actor-name, .actor-name-row";

/**
 * The review mark, beside the name, through Tidy's content API.
 *
 * WHY NOT JUST INSERT IT
 * ----------------------
 * Because this file exists to say that you cannot: Tidy renders with Svelte and
 * rebuilds parts of itself, and an element we append to the name would be gone
 * at the next update with nothing to explain it. The header controls were the
 * first answer to that, and they put the mark in the row of action buttons -
 * correct, and not where a mark about the character's name belongs.
 *
 * `registerCharacterContent` is Tidy's own answer: it keeps the registration
 * and re-injects it into the matching element on every render, which is
 * precisely the problem we could not solve from outside.
 *
 * ONE REGISTRATION PER STATE, because the model takes `html` as a fixed string
 * decided now, while `enabled(context)` runs on every render. So the thing that
 * varies is which registration is showing, not what is inside one. Exactly one
 * ever matches - the same shape as the fallback controls below.
 *
 * The tooltip is refreshed in `onRender` rather than baked into that string:
 * the sentence carries the date the GM acted, which is not knowable when the
 * module loads.
 *
 * @returns {boolean} Whether it registered. False means this Tidy does not have
 *                    the content API in the shape we read, and the caller falls
 *                    back to the header controls.
 */
function registerReviewMark(api) {
  const HtmlContent = api?.models?.HtmlContent;
  if (!HtmlContent || typeof api.registerCharacterContent !== "function") {
    trace("Tidy has no content API in the expected shape - review mark falls back to a control");
    return false;
  }

  for (const face of REVIEW_FACES) {
    const marker = `is-${face.state || "none"}`;

    api.registerCharacterContent(
      new HtmlContent({
        html:
          `<span class="pk5e-review-badge ${marker}" role="img">` +
          `<i class="${face.icon}"></i></span>`,
        injectParams: { selector: TIDY_NAME_ANCHOR, position: "beforeend" },
        enabled(context) {
          const badge = reviewBadge(context?.actor ?? context?.document);
          return !!badge && badge.state === face.state;
        },
        onRender({ app, element }) {
          const actor = app?.document ?? app?.actor;
          const mark = element?.querySelector(`.pk5e-review-badge.${marker}`);
          if (!actor || !mark) return;
          const label = reviewLabel(actor);
          mark.dataset.tooltip = label;
          mark.setAttribute("aria-label", label);
        }
      })
    );
  }

  trace("Tidy review mark registered beside the name");
  return true;
}

/**
 * The same four faces as a fallback, in the header controls.
 *
 * Only used when `registerReviewMark()` could not register - a Tidy whose
 * content API is not in the shape read out of 13.9.3. The row of action buttons
 * is not where a mark about the name belongs, which is the whole reason for the
 * function above, but it is somewhere, and somewhere beats nowhere on a version
 * we have not seen.
 *
 * FOUR CONTROLS FOR ONE MARK, for the same reason as above: Tidy takes `icon`
 * and `label` as fixed strings at registration while `visible()` runs on every
 * render, so what varies is which control is showing.
 *
 * No `ownership`, unlike the two buttons above: this is read-only, and the
 * person most likely to want it at a glance is the GM, who owns nobody's
 * character.
 */
function reviewControls() {
  const faces = [
    ["", "fa-regular fa-circle", "Not sent to the GM yet"],
    ["pending", "fa-solid fa-circle-half-stroke", "Waiting for the GM"],
    ["approved", "fa-solid fa-circle-check", "Approved by the GM"],
    ["returned", "fa-solid fa-circle-exclamation", "Sent back by the GM"]
  ];

  return faces.map(([state, icon, label]) => ({
    icon,
    label,
    action: `${MODULE_ID}-review-${state || "none"}`,
    position: "header",
    visible() {
      const badge = reviewBadge(this.document);
      return !!badge && badge.state === state;
    },
    // The date and the GM's note live in the panel, which is one click away.
    // Repeating them in a header tooltip would mean keeping two wordings in
    // step for no gain.
    async onClickAction() {
      CreationGuide.open(this.document.id);
    }
  }));
}


export function registerTidyControls() {
  if (registered) return;

  Hooks.once("tidy5e-sheet.ready", (api) => {
    if (!api?.registerCharacterHeaderControls) {
      console.warn(`${MODULE_ID} | Tidy is present but its API looks unfamiliar`);
      return;
    }

    try {
      // Attempted first, because whether it worked decides what goes into the
      // controls array below - and that array is registered in one call.
      const markedByName = registerReviewMark(api);

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
          },
          ...(markedByName ? [] : reviewControls())
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
