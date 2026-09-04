/**
 * review.mjs
 * ---------------------------------------------------------------------------
 * Handing a finished character to the GM, and the GM handing it back.
 *
 * The workflow itself is thin: a flag with three states and one whispered chat
 * message. What makes it worth having is the REPORT that travels with it.
 * Three separate readings of a character already exist in this module, and
 * only the first of them is visible to someone opening the sheet by hand:
 *
 *   validate.mjs    what is missing, at zero, or unassigned
 *   checkup.mjs     what the class grants at this level and never arrived
 *   option-watch    choices skipped inside the importer's own dialogs
 *
 * The third one is the reason this file exists. A skipped dialog leaves
 * NOTHING behind in the actor's data - the importer's generated ItemGrant
 * advancements set optional:false, so an unanswered question is
 * indistinguishable from one that was never asked (docs/importer-internals.md).
 * A GM reading the sheet cannot recover it at any price. This module watched it
 * happen and wrote it down, so the card can simply say it.
 *
 * CHAT, NOT A SOCKET
 * A socket only reaches a GM who is logged in, and characters get made the
 * evening before the session. A whispered message waits for them.
 *
 * THIS FILE FAILS LOUDLY, ON PURPOSE
 * Everywhere else the convention is to fail quietly (CLAUDE.md): a selector
 * that stops matching must never break character creation. Here silence means
 * the player believes the GM is looking at something the GM never received. So
 * the flag is written only AFTER the message exists, and every failure raises a
 * notification. Do not quieten this down to match the rest of the module.
 *
 * NOT A PERMISSION SYSTEM
 * The flag lives on the actor, which the player owns, so a player with the
 * console open can write "approved" themselves. This is a table convention with
 * a paper trail, not access control, and the README says as much.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { checkCharacter } from "./validate.mjs";
import { rulesChecks } from "./checkup.mjs";
import { isAvailable } from "./rules-data.mjs";
import { skippedOptions, skippedText } from "./option-watch.mjs";
import { gainSections } from "./gains.mjs";
import { buildSummary, escape } from "./summary.mjs";

export const REVIEW_FLAG = "review";

export const PENDING = "pending";
export const APPROVED = "approved";
export const RETURNED = "returned";

const STATES = [PENDING, APPROVED, RETURNED];

/**
 * The step's own item is left out of its gains, for the same reason the panel
 * leaves it out: "Class: Fighter" under the heading "Class" is noise, and the
 * card carries the class in its header already.
 */
const GAIN_SKIP = {
  class: ["class", "subclass"],
  species: ["race", "species"],
  background: ["background"]
};

/** The review record on this character, or null. */
export function readReview(actor) {
  const value = actor?.getFlag?.(MODULE_ID, REVIEW_FLAG) ?? null;
  return value && typeof value === "object" ? value : null;
}

/**
 * Where the character stands, as one of the three states or "".
 *
 * Anything unrecognised reads as "" rather than being passed through: a state
 * this version does not know about must not light the panel up as though it
 * did.
 */
export function reviewState(actor) {
  const state = readReview(actor)?.state ?? "";
  return STATES.includes(state) ? state : "";
}

/** Sending twice while the GM has not answered would only spam them. */
export function canSubmit(state) {
  return state !== PENDING;
}

/**
 * What each creation step actually delivered, one line per step.
 *
 * Read from the `gains` flag rather than from the sheet, so it says what
 * ARRIVED during creation rather than what is there now - which is the
 * question a GM asking "did this import finish properly" actually has.
 */
export function gainLines(actor) {
  const records = actor?.getFlag?.(MODULE_ID, "gains") ?? {};
  const lines = [];

  for (const [key, record] of Object.entries(records)) {
    const sections = gainSections(record, {
      skipTypes: GAIN_SKIP[key] ?? [],
      kind: key,
      actor
    });
    const text = sections
      .flatMap((section) =>
        section.entries.map((entry) => (entry.detail ? `${entry.label} ${entry.detail}` : entry.label))
      )
      .join(", ");
    if (text) lines.push({ label: t(`step.${key}`), text });
  }

  return lines;
}

/**
 * Everything the card is built from, in one plain object.
 *
 * Pure - it reads flags and the checks it is handed, and writes nothing - so
 * tests/run.mjs can put a stand-in actor through it without a live game.
 *
 * `rulesRead` is passed in rather than inferred from an empty check list,
 * because "the comparison found nothing" and "the comparison could not run"
 * are the same empty list and mean opposite things (checkup.mjs).
 */
export function reviewPayload(actor, { checks = [], rulesRead = false } = {}) {
  const failures = checks.filter((check) => !check.ok);
  const skipped = skippedOptions(actor).map((entry) => skippedText(entry));

  return {
    failures,
    skipped,
    gains: gainLines(actor),
    rulesRead,
    counts: {
      errors: failures.filter((check) => check.level === "error").length,
      warnings: failures.filter((check) => check.level !== "error").length,
      skipped: skipped.length
    }
  };
}

const list = (items) => `<ul class="pk5e-report-list">${items.join("")}</ul>`;

const finding = (check) =>
  `<li class="pk5e-report-item is-${escape(check.level)}">` +
  `<span class="pk5e-report-label">${escape(check.label)}</span>` +
  `<span class="pk5e-report-hint">${escape(check.hint)}</span></li>`;

/**
 * The card itself.
 *
 * Skipped choices come FIRST, above the ordinary checklist: they are the part
 * the GM cannot find any other way, and a card that buries them under six lines
 * about hit points has thrown away its own reason for existing.
 */
export function buildReviewCard(actor, payload) {
  const { failures, skipped, gains, rulesRead } = payload;
  const parts = [buildSummary(actor)];

  parts.push(`<p class="pk5e-review-headline">${escape(t("review.cardTitle"))}</p>`);

  if (skipped.length) {
    parts.push(
      `<div class="pk5e-review-block"><h4>${escape(t("review.skipped"))}</h4>` +
        list(
          skipped.map(
            (text) =>
              `<li class="pk5e-report-item is-warning"><span class="pk5e-report-label">${escape(text)}</span></li>`
          )
        ) +
        `</div>`
    );
  }

  if (failures.length) {
    parts.push(
      `<div class="pk5e-review-block"><h4>${escape(t("review.findings"))}</h4>` +
        list(failures.map(finding)) +
        `</div>`
    );
  } else if (!skipped.length) {
    parts.push(`<p class="pk5e-note">${escape(t("review.noFindings"))}</p>`);
  }

  if (gains.length) {
    parts.push(
      `<div class="pk5e-review-block"><h4>${escape(t("review.gains"))}</h4>` +
        gains
          .map(
            (line) =>
              `<p class="pk5e-review-gain"><span class="pk5e-report-label">${escape(line.label)}</span> ` +
              `<span class="pk5e-report-hint">${escape(line.text)}</span></p>`
          )
          .join("") +
        `</div>`
    );
  }

  // Said out loud, never left to silence: without this line a card with no
  // rules findings reads as "the class is complete" when the truth may be
  // "the rules data was not loaded and nothing was compared at all".
  if (!rulesRead) {
    parts.push(`<p class="pk5e-review-foot">${escape(t("review.rulesUnavailable"))}</p>`);
  }

  return `<div class="pk5e-review-card">${parts.join("")}</div>`;
}

/** The GM users a whisper should go to, by id. */
function gmIds() {
  try {
    return ChatMessage.getWhisperRecipients("GM")
      .map((user) => user.id)
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

/** The players who own this character, by id. A GM is not an "owner" here. */
function ownerIds(actor) {
  const levels = actor?.ownership ?? {};
  const owner = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  return (game.users ?? [])
    .filter((user) => !user.isGM && levels[user.id] === owner)
    .map((user) => user.id);
}

/**
 * Player side: post the card to the GM and mark the character as waiting.
 *
 * The flag is written only once the message exists. A record saying "waiting
 * for the GM" on a character the GM was never told about is the one outcome
 * this whole file is arranged to avoid.
 */
export async function submitForReview(actor) {
  if (!actor) return null;

  // An empty whisper list is a PUBLIC message in Foundry, so a world with no
  // GM user would broadcast the character to everyone instead of failing.
  const recipients = gmIds();
  if (!recipients.length) {
    ui.notifications.error(t("review.noGm"));
    return null;
  }

  const report = checkCharacter(actor);
  const rulesRead = isAvailable();
  const fromRules = await rulesChecks(actor);
  const payload = reviewPayload(actor, {
    checks: [...(report.checks ?? []), ...fromRules],
    rulesRead
  });

  // Taken before the message exists, and written into BOTH the message and the
  // record, so the card and the flag agree on which round they belong to. The
  // flag is still written afterwards - a submission must never be recorded as
  // sent before it has been - and this is what lets a card tell "the decision
  // above me is from the previous round" from "the decision above me is mine".
  const sentAt = Date.now();

  let message = null;
  try {
    message = await ChatMessage.create({
      content: buildReviewCard(actor, payload),
      speaker: { alias: actor.name },
      whisper: recipients,
      flags: { [MODULE_ID]: { review: { actorId: actor.id, at: sentAt } } }
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not send the character for review`, err);
    ui.notifications.error(t("review.failed", err.message));
    return null;
  }

  if (!message) {
    ui.notifications.error(t("review.failed", ""));
    return null;
  }

  const record = {
    state: PENDING,
    at: sentAt,
    by: game.user?.id ?? "",
    note: "",
    // Frozen at the moment of sending. The panel goes on counting live, so a
    // disagreement between the two says the sheet was touched after it was
    // handed in - which is worth seeing rather than smoothing over.
    found: payload.counts,
    rulesRead
  };

  try {
    await actor.setFlag(MODULE_ID, REVIEW_FLAG, record);
  } catch (err) {
    console.error(`${MODULE_ID} | The review was sent but could not be recorded`, err);
    ui.notifications.error(t("review.failed", err.message));
    return null;
  }

  ui.notifications.info(t("review.sentToast"));
  return record;
}

/** GM side: record the decision and tell the player about it. */
export async function decideReview(actor, { state, note = "" } = {}) {
  if (!actor) {
    ui.notifications.warn(t("review.gone"));
    return null;
  }
  if (state !== APPROVED && state !== RETURNED) return null;

  const record = {
    ...(readReview(actor) ?? {}),
    state,
    at: Date.now(),
    by: game.user?.id ?? "",
    // Only a returned character carries a note. Keeping the old one through an
    // approval would leave "fix the languages" sitting under "approved".
    note: state === RETURNED ? String(note ?? "") : ""
  };

  try {
    await actor.setFlag(MODULE_ID, REVIEW_FLAG, record);
  } catch (err) {
    console.error(`${MODULE_ID} | Could not record the decision`, err);
    ui.notifications.error(t("review.failed", err.message));
    return null;
  }

  const headline = t(
    state === APPROVED ? "review.decisionApproved" : "review.decisionReturned",
    actor.name
  );
  const body = record.note ? `<p class="pk5e-report-hint">${escape(record.note)}</p>` : "";

  try {
    await ChatMessage.create({
      content:
        `<div class="pk5e-review-decision is-${state}">` +
        `<p class="pk5e-review-headline">${escape(headline)}</p>${body}</div>`,
      speaker: { alias: actor.name },
      // The owners, so the player reads it, and the GMs, so the decision is in
      // their log too - a whisper the sender cannot see reads as if nothing
      // had happened.
      whisper: [...new Set([...ownerIds(actor), ...gmIds()])]
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Could not tell the player`, err);
    ui.notifications.warn(t("review.failed", err.message));
  }

  ui.notifications.info(t(state === APPROVED ? "review.approvedToast" : "review.returnedToast"));
  return record;
}

/** The note the GM types when sending a character back. null means cancelled. */
async function askForNote() {
  const Dialog = foundry.applications?.api?.DialogV2;
  if (!Dialog?.prompt) return "";
  try {
    const value = await Dialog.prompt({
      window: { title: t("review.notePrompt") },
      content: `<input type="text" name="note" autofocus style="width: 100%">`,
      ok: {
        label: t("review.sendBack"),
        callback: (event, button) => button.form?.elements?.note?.value ?? ""
      }
    });
    return typeof value === "string" ? value : "";
  } catch (err) {
    // DialogV2 rejects when the window is closed, which is a cancellation
    // rather than a failure: the character is left exactly as it was.
    return null;
  }
}

/**
 * What this particular card can still do - which is a different question from
 * what state the character is in.
 *
 * WHY THE STATE ALONE IS NOT ENOUGH
 * ---------------------------------
 * It was, and it was wrong in both directions:
 *
 *   1. A resubmission showed no buttons. The flag is written AFTER the message
 *      exists, deliberately (see the header: never claim a character was sent
 *      when it was not). So while the new card renders, the actor still carries
 *      the previous decision, and a card that only asked "what is the state
 *      now" answered "already sent back" over a submission nobody had read yet.
 *      The same gap opens on a second GM's client for a different reason - the
 *      message and the flag arrive as two separate broadcasts, in no
 *      guaranteed order.
 *
 *   2. The old card came back to life. Once the player resubmitted, the state
 *      was `pending` again, so LAST round's card grew a fresh pair of buttons
 *      and the GM could approve a character from a report that had since been
 *      superseded.
 *
 * So the card carries the moment it was sent, and the record carries the moment
 * it last moved. Comparing the two says which round this card belongs to, which
 * is what both cases actually turn on.
 *
 * @returns {"gone"|"decided"|"superseded"|"open"}
 */
export function cardStance(actor, { sentAt = 0 } = {}) {
  if (!actor) return "gone";

  const state = reviewState(actor);
  const movedAt = Number(readReview(actor)?.at) || 0;
  const sent = Number(sentAt) || 0;
  const decided = state === APPROVED || state === RETURNED;

  // Cards from before the timestamp was written have nothing to compare, so
  // they fall back to reading the live state - exactly what every card did.
  if (!sent) return decided ? "decided" : "open";

  // A decision OLDER than this card belongs to an earlier round: this is the
  // resubmission, and it is waiting to be read.
  if (decided) return movedAt >= sent ? "decided" : "open";

  // Waiting, but something newer has been sent since this card was.
  return movedAt > sent ? "superseded" : "open";
}

/**
 * The two buttons, added to the GM's copy of the message as it renders.
 *
 * Added here rather than written into the message body, so a player never has
 * them in their DOM at all, and so the state is read at DRAW time: a card
 * scrolled back to a week later shows what became of it since.
 *
 * `data-pk5e-review` rather than `data-action`, because chat messages have
 * their own delegated handling of that attribute and this must not collide.
 */
function decorate(message, element) {
  if (!game.user?.isGM) return;

  const data = message?.flags?.[MODULE_ID]?.review;
  if (!data?.actorId) return;

  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;

  const host =
    root.querySelector(".pk5e-review-card") ?? root.querySelector(".message-content") ?? root;
  if (!host || host.querySelector(".pk5e-review-actions")) return;

  const actor = game.actors?.get(data.actorId) ?? null;
  const stance = cardStance(actor, { sentAt: data.at });

  const bar = document.createElement("div");
  bar.className = "pk5e-review-actions";

  if (stance === "gone") {
    bar.innerHTML = `<span class="pk5e-note">${escape(t("review.gone"))}</span>`;
  } else if (stance === "decided") {
    const key = reviewState(actor) === APPROVED ? "review.alreadyApproved" : "review.alreadyReturned";
    bar.innerHTML = `<span class="pk5e-note">${escape(t(key))}</span>`;
  } else if (stance === "superseded") {
    bar.innerHTML = `<span class="pk5e-note">${escape(t("review.superseded"))}</span>`;
  } else {
    bar.innerHTML =
      `<button type="button" data-pk5e-review="approve">${escape(t("review.approve"))}</button>` +
      `<button type="button" data-pk5e-review="return">${escape(t("review.sendBack"))}</button>`;

    for (const button of bar.querySelectorAll("[data-pk5e-review]")) {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        const buttons = bar.querySelectorAll("button");
        for (const other of buttons) other.disabled = true;

        const approving = button.dataset.pk5eReview === "approve";
        const note = approving ? "" : await askForNote();

        if (!approving && note === null) {
          for (const other of buttons) other.disabled = false;
          return;
        }

        await decideReview(actor, { state: approving ? APPROVED : RETURNED, note });
      });
    }
  }

  host.appendChild(bar);
}

/** Called once, on ready. */
export function registerReviewHooks() {
  // v13 renamed the hook and hands over an HTMLElement now; module.json asks
  // for 13 as a minimum, so the older spelling is not worth carrying.
  Hooks.on("renderChatMessageHTML", (message, element) => {
    try {
      decorate(message, element);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not decorate a review message`, err);
    }
  });
}

/** Whether the world has this flow turned on at all. */
export function reviewEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, "reviewFlow");
  } catch (err) {
    return false;
  }
}

/**
 * One sentence saying where the character stands, with the date it got there.
 *
 * Shared by the panel and by the mark on the sheet, so the two cannot drift
 * into saying different things about the same flag.
 */
export function reviewLabel(actor) {
  const record = readReview(actor);
  const state = reviewState(actor);
  const when = record?.at ? new Date(record.at).toLocaleDateString() : "";

  if (state === PENDING) return t("review.pending", when);
  if (state === APPROVED) return t("review.approved", when);
  if (state === RETURNED) return t("review.returned", when);
  return t("review.notYet");
}

/**
 * The mark that sits beside the character's name on the sheet.
 *
 * FOUR STATES, NOT TWO. A tick and an empty circle would cover "approved" and
 * "not approved", and a character the GM has sent back would then wear the same
 * empty circle as one nobody has ever submitted - which is the one case where
 * the player has something to do about it. So the circle also has a waiting
 * face and a returned one, all four the same shape and size so the row of
 * header icons does not change width as the state moves.
 *
 * Colour carries the meaning and the tooltip carries the sentence, because a
 * colour alone is no good to a player who cannot tell green from grey.
 *
 * Returns null when there is nothing to draw - the setting is off, or this is
 * not a character - so the caller has one thing to check rather than three.
 */
/**
 * The four faces, in order, shared with tidy.mjs.
 *
 * Exported as a list rather than kept as a lookup here, because the Tidy path
 * has to register one piece of content per state - its content is a fixed
 * string decided when the module loads - and a second copy of these icons is
 * exactly the drift that made dock.mjs stop recognising the importer.
 */
export const REVIEW_FACES = [
  { state: "", icon: "fa-regular fa-circle" },
  { state: PENDING, icon: "fa-solid fa-circle-half-stroke" },
  { state: APPROVED, icon: "fa-solid fa-circle-check" },
  { state: RETURNED, icon: "fa-solid fa-circle-exclamation" }
];

const faceFor = (state) => REVIEW_FACES.find((face) => face.state === state) ?? REVIEW_FACES[0];

export function reviewBadge(actor) {
  if (!reviewEnabled()) return null;
  if (!actor || actor.type !== "character") return null;

  const state = reviewState(actor);
  return {
    state,
    icon: faceFor(state).icon,
    label: reviewLabel(actor)
  };
}

/**
 * The mark as an element, ready to append.
 *
 * Both places that draw it by hand - the sheet header and the actor directory -
 * come through here, so the class names, the tooltip and the accessible name
 * cannot drift apart between them. The Tidy path cannot use this: its content
 * is registered as a fixed string when the module loads, which is why
 * REVIEW_FACES exists as a list.
 *
 * Returns null when there is nothing to draw, so a caller has one thing to
 * check rather than three.
 */
export function reviewMark(actor) {
  const badge = reviewBadge(actor);
  if (!badge) return null;

  const mark = document.createElement("span");
  mark.className = `pk5e-review-badge is-${badge.state || "none"}`;
  mark.dataset.tooltip = badge.label;
  // The tooltip is a hover; a screen reader gets the same sentence outright.
  mark.setAttribute("aria-label", badge.label);
  mark.setAttribute("role", "img");
  mark.innerHTML = `<i class="${badge.icon}"></i>`;
  return mark;
}

/**
 * Everything the panel needs in order to draw the state, in one object.
 *
 * Built here rather than in guide.mjs so the wording and the state machine stay
 * in the same file as the flag they describe.
 */
export function reviewContext(actor, { problems = 0 } = {}) {
  const record = readReview(actor);
  const state = reviewState(actor);

  return {
    enabled: reviewEnabled(),
    state,
    label: reviewLabel(actor),
    canSubmit: canSubmit(state),
    note: state === RETURNED ? (record?.note ?? "") : "",
    // The live count, not the frozen one: the button is about what is being
    // sent now.
    button: problems ? t("review.submitWithProblems", problems) : t("review.submit")
  };
}
