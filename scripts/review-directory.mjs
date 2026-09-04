/**
 * review-directory.mjs - the review state in the Actors sidebar.
 *
 * The chat card is where a submission is acted on, and the mark beside the
 * name on the sheet says where one character stands. Neither answers the
 * question a GM actually opens Foundry with: who is waiting on me right now.
 * Chat scrolls, and a card sent last week is not findable; the sheet has to be
 * opened one character at a time.
 *
 * So the list of what is waiting is the actor directory itself, not a window
 * of its own. A queue window was considered and dropped on purpose: the
 * submission already has one place where it is decided, and a second place
 * showing the same thing is a second place that can disagree with the flag.
 * This draws no verdict and offers no button - it says "something is waiting
 * here" and sends the GM back to the card.
 *
 * Two things are added, both inside markup that was read out of a live Foundry
 * (v14 build 367, dnd5e 5.3.3), not guessed:
 *
 *   - `li.directory-item.entry[data-entry-id]` with `a.entry-name` inside it,
 *     from templates/sidebar/partials/document-partial.hbs - one row per
 *     actor, and where the mark is appended.
 *   - `header.directory-header` holding `.header-actions` and a `<search>` row
 *     of small icon buttons, from templates/sidebar/directory/header.hbs -
 *     where the counter goes. The search row rather than the actions row
 *     because the actions row is full-width buttons and a count is not one.
 *
 * Folders nest their rows in `ol.subdirectory`, and a folder that is not
 * `.expanded` hides it in core CSS. Filtering therefore has to open the
 * folders that contain something, which is done by adding the class Foundry
 * uses and taking it off again - not by fighting that rule with a more
 * specific one of our own, which would break silently the day the rule moves.
 *
 * Fail quietly, like everything else that touches foreign markup: if the
 * selectors stop matching, the sidebar is exactly as it was.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { trace } from "./trace.mjs";
import { reviewEnabled, reviewMark, reviewState, REVIEW_FLAG, PENDING } from "./review.mjs";

/** Directory-wide, not per render: a re-render must not silently drop it. */
let filterOn = false;

const FILTER_CLASS = "pk5e-pending-only";
const PENDING_ROW = "pk5e-pending";
const PENDING_FOLDER = "pk5e-has-pending";
/** Marks a folder this module opened, so only those get closed again. */
const OPENED_BY_US = "pk5eOpened";

/**
 * Draws one mark per row and reports how many are waiting.
 *
 * Every character gets its mark, not only the waiting ones - the empty circle
 * is the difference between "nobody has submitted this" and "this module is
 * not looking at it", and a player scanning their own sidebar reads the same
 * four faces as on the sheet.
 */
function markRows(root) {
  let pending = 0;

  for (const row of root.querySelectorAll("li.directory-item.entry[data-entry-id]")) {
    row.querySelectorAll(".pk5e-review-badge").forEach((el) => el.remove());
    row.classList.remove(PENDING_ROW);

    const actor = game.actors?.get(row.dataset.entryId);
    const mark = reviewMark(actor);
    if (!mark) continue;

    // On the row, NOT inside a.entry-name. That anchor carries .ellipsis -
    // overflow hidden - so a mark appended into it disappears behind the
    // ellipsis on exactly the long names a crowded sidebar is full of. As a
    // flex item of the row it also lands at the right edge, which turns a
    // scrolling list into one readable column of faces.
    row.appendChild(mark);

    if (reviewState(actor) === PENDING) {
      pending += 1;
      row.classList.add(PENDING_ROW);
      // Every folder above it, so a filtered view still shows the path down.
      for (let box = row.parentElement; box && box !== root; box = box.parentElement) {
        if (box.matches?.("li.directory-item.folder")) box.classList.add(PENDING_FOLDER);
      }
    }
  }

  return pending;
}

/** Opens the folders holding something waiting, or puts them back. */
function setFolders(root, open) {
  if (open) {
    for (const folder of root.querySelectorAll(`li.directory-item.folder.${PENDING_FOLDER}`)) {
      if (folder.classList.contains("expanded")) continue;
      folder.classList.add("expanded");
      folder.dataset[OPENED_BY_US] = "1";
    }
    return;
  }

  for (const folder of root.querySelectorAll("li.directory-item.folder[data-pk5e-opened]")) {
    folder.classList.remove("expanded");
    delete folder.dataset[OPENED_BY_US];
  }
}

function applyFilter(root) {
  root.classList.toggle(FILTER_CLASS, filterOn);
  setFolders(root, filterOn);
}

/**
 * The counter, and the only control this module puts in the sidebar.
 *
 * Drawn only when something is actually waiting. A button reading "0" is a
 * button that is wrong to press, and it would sit in every GM's sidebar for
 * the entire life of a campaign in which the flow was switched on once.
 *
 * GM only. The count is "waiting for the GM", and to a player it would be a
 * count of other people's characters they cannot do anything about.
 */
function addCounter(root, pending) {
  root.querySelectorAll(".pk5e-review-filter").forEach((el) => el.remove());
  if (!pending || !game.user?.isGM) return;

  const header = root.querySelector("header.directory-header");
  const target = header?.querySelector("search") ?? header?.querySelector(".header-actions") ?? header;
  if (!target) {
    trace("no directory header to put the review count in");
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pk5e-review-filter inline-control";
  button.setAttribute("aria-pressed", String(filterOn));
  const label = filterOn ? t("review.dirFilterOff") : t("review.dirFilter", pending);
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = `<i class="fa-solid fa-circle-half-stroke"></i><span>${pending}</span>`;

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    filterOn = !filterOn;
    applyFilter(root);
    addCounter(root, pending);
  });

  target.appendChild(button);
}

/**
 * Draws everything, and is the whole of what a render does.
 *
 * Exported for tests/markup.mjs: the parts worth testing here are DOM work,
 * and a stub of the DOM would only test the stub.
 */
export function decorate(html) {
  if (!reviewEnabled()) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const pending = markRows(root);
  // Nothing left waiting closes the filter rather than leaving an empty list
  // with no visible way back.
  if (!pending) filterOn = false;
  applyFilter(root);
  addCounter(root, pending);
}

/** Called once, on ready. */
export function registerReviewDirectory() {
  Hooks.on("renderActorDirectory", (app, html) => {
    try {
      decorate(html);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not mark review state in the sidebar`, err);
    }
  });

  // A decision changes a flag, and a flag change re-renders no sidebar on its
  // own - the directory redraws for names and folders. Without this the count
  // stays wrong until something else happens to redraw it, which on a quiet
  // evening can be a long time.
  Hooks.on("updateActor", (actor, changed) => {
    if (!reviewEnabled()) return;
    if (changed?.flags?.[MODULE_ID]?.[REVIEW_FLAG] === undefined) return;
    ui.actors?.render();
  });
}
