/**
 * steps.mjs
 * ---------------------------------------------------------------------------
 * What the seven steps of the panel are, and what each of them currently shows.
 *
 * This was the largest part of guide.mjs's _prepareContext, which had grown to
 * 282 lines - four times the next longest function in the module - and was
 * holding the step definitions alongside window state, ownership, folders, the
 * language switch and the readiness report. The definitions are the part that
 * changes when the rules change, so they are worth being able to find.
 *
 * buildSteps() is given the actor and returns the list. It reads the character
 * and settings; it does not write anything, and knows nothing about the window
 * it will be drawn in.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { text, importFlowNote } from "./sheet-actions.mjs";
import { usesCompendium } from "./source-mode.mjs";
import { itemsWithSkippedChoices, abilitiesAssigned } from "./validate.mjs";
import { languageLabels } from "./languages.mjs";

/** Readable names for the ability score methods stored on the actor. */
const METHOD_KEYS = {
  standard: "method.standard",
  pointbuy: "method.pointbuy",
  roll: "method.roll",
  manual: "method.manual"
};


/**
 * A short summary taken from whatever was imported.
 *
 * Works on paragraphs rather than the flattened text. Captions, headings, trait
 * tables and artist credits are not paragraphs of prose, so filtering at that
 * level removes them without guessing. Foundry enricher syntax (@UUID[...],
 * [[/r ...]], &Reference[...]) is stripped too - it is markup, not writing.
 */
function shortSummary(item) {
  const raw = item?.system?.description?.value ?? "";
  if (!raw) return "";

  const stripped = raw
    .replace(/<(script|style|table|figure|figcaption)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, " ");

  const clean = (html) =>
    html
      // Entities first. A description from DDB Importer writes the enricher as
      // "&amp;Reference[slt]{Sleight of Hand}", so decoding after the strip
      // left the markup on screen with the ampersand restored - which is how
      // "&Reference[slt]{Sleight of Hand}" ended up in a background summary.
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
      .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
      .replace(/&mdash;/g, "-")
      // The braces hold what the enricher would have displayed, so they are
      // kept: "Sleight of Hand" is the point of the sentence, not decoration.
      .replace(/[@&]\w+\[[^\]]*\]\{([^}]*)\}/g, "$1")
      .replace(/[@&]\w+\[[^\]]*\]/g, " ")
      // Roll syntax has no display text worth keeping.
      .replace(/\[\[[^\]]*\]\]/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const paragraphs = Array.from(stripped.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map((m) =>
    clean(m[1])
  );
  const candidates = paragraphs.length ? paragraphs : [clean(stripped)];

  const boilerplate = /free rules|creative commons|re-distributed|^source\b/i;

  for (const paragraph of candidates) {
    if (paragraph.length < 60 || boilerplate.test(paragraph)) continue;

    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let text = sentences[0]?.trim() ?? "";
    // One sentence is often too terse; take a second if there is room.
    if (text.length < 110 && sentences[1]) text = `${text} ${sentences[1].trim()}`;
    if (text.length < 40) continue;

    return text.length > 260 ? `${text.slice(0, 257)}...` : text;
  }
  return "";
}

export function buildSteps(actor, { importing = false } = {}) {

  const species = actor.items.find((i) => i.type === "race" || i.type === "species");
  const background = actor.items.find((i) => i.type === "background");
  // Every class, not just the first: a multiclassed character would otherwise
  // silently lose half its build on this step.
  const classes = actor.items.filter((i) => i.type === "class");
  const subclasses = actor.items.filter((i) => i.type === "subclass");

  const subclassFor = (item) =>
    subclasses.find(
      (sub) =>
        !item.system?.identifier ||
        sub.system?.classIdentifier === item.system.identifier
    );

  const cls = classes[0] ?? null;
  const subclass = cls ? subclassFor(cls) : null;

  const classLine = classes
    .map((item) => {
      const sub = subclassFor(item);
      return `${item.name} ${item.system?.levels ?? 1}${sub ? ` - ${sub.name}` : ""}`;
    })
    .join(" · ");

  const totalLevel = classes.reduce((sum, item) => sum + (item.system?.levels ?? 0), 0);
  const savedAbilities = actor.getFlag(MODULE_ID, "abilities");

  // Read from the sheet as well as from our own flag: a character imported by
  // another tool arrives complete, but not by us. Shared with the checklist so
  // the two cannot disagree - the same window once said "7 of 7 done" and
  // "ability scores not assigned".
  const abilitiesDone = !!savedAbilities || abilitiesAssigned(actor);
  const abilityMethod = METHOD_KEYS[savedAbilities?.method]
    ? t(METHOD_KEYS[savedAbilities.method])
    : "";

  // The [+] that hides each entry's description is the IMPORTER's. The
  // Compendium Browser shows its descriptions on hover instead, so pointing at
  // a control that is not there would be worse than saying nothing.
  const expandHint = usesCompendium(actor) ? "" : t("guide.expandHint");

  const portrait = actor.img ?? "";
  const hasPortrait =
    !!portrait && !portrait.includes("mystery-man") && !portrait.includes("svg/actors");

  // `value` is a Set, so JSON.stringify shows it as {} and reading it that way
  // would find every character languageless. Array.from is what tells the truth.
  const known = actor.system?.traits?.languages?.value;
  const languageKeys = known ? Array.from(known) : [];
  const custom = String(actor.system?.traits?.languages?.custom ?? "").trim();
  const languageCount = languageKeys.length + (custom ? 1 : 0);

  // Headline counts, detail below the line - same shape as the other steps.
  let languageHeadline = "";
  let languageSummary = "";
  if (languageCount) {
    const MAX_SHOWN = 10;
    const labels = languageLabels(languageKeys);
    const shown = labels.slice(0, MAX_SHOWN).join(", ");
    const rest = labels.length > MAX_SHOWN ? " (...)" : "";
    languageHeadline =
      languageCount === 1 ? t("guide.languageCountOne") : t("guide.languageCount", languageCount);
    languageSummary = `${shown}${rest}`;
  }

  // Which items were added with their choice dialogs skipped. Looked up once
  // per render and attached to the entry itself: collected at the bottom of
  // the panel the warning sat a long way from the thing it was about, and
  // with two classes there was no telling which one it meant.
  // Not while an import is running. The importer sometimes puts its choice dialog
  // up a moment after the item lands, so checking straight away reports a
  // character as having skipped something they are about to be asked.
  const skippedIds = importing
    ? new Set()
    : new Set(itemsWithSkippedChoices(actor).map((problem) => problem.id));

  const entryFor = (item, label, summary, alsoCheck = null) => ({
    itemId: item.id,
    // Above level 1 a single level can be stepped back, which is far less
    // destructive than removing the class. Offered on the entry itself rather
    // than only alongside a detected problem: a player who realises they
    // misclicked should not have to wait for the module to notice.
    canDelevel: item.type === "class" && Number(item.system?.levels ?? 1) > 1,
    level: Number(item.system?.levels ?? 1),
    name: label ?? item.name,
    img: item.img ?? "",
    summary: summary ?? shortSummary(item),
    // A subclass is shown inside its class's entry, so its skipped choices
    // have to be reported there - removing the class takes it with it anyway.
    skipped: skippedIds.has(item.id) || (alsoCheck ? skippedIds.has(alsoCheck.id) : false),
    kind: t(`check.kind.${item.type}`),
    kindOf: t(`check.kindOf.${item.type}`)
  });

  // Order follows D&D Beyond: class first, because it is the decision the
  // rest of the character is built around, and the one a new player arrives
  // already having an opinion about.
  //
  // Numbers come from the position rather than being written in, so that
  // reordering this list is the whole of the change.
  const steps = [
    {
      key: "class",
      label: t("step.class"),
      actionLabel: t("stepAcc.class"),
      icon: "fa-shield-halved",
      levelUp: classes.length > 0,
      help: t("help.class") + importFlowNote(actor),
      removable: true,
      done: classes.length > 0,
      entries: classes.map((item) => {
        const sub = subclassFor(item);
        const label = `${item.name} ${item.system?.levels ?? 1}${sub ? ` - ${sub.name}` : ""}`;
        return entryFor(item, label, shortSummary(sub) || shortSummary(item), sub);
      }),
      multiclass: classes.length > 1,
      totalLevel,
      blurb: text("textClass", "blurb.class")
    },
    {
      key: "species",
      label: t("step.species"),
      actionLabel: t("stepAcc.species"),
      icon: "fa-dna",
      help: t("help.species") + importFlowNote(actor),
      removable: true,
      done: !!species,
      entries: species ? [entryFor(species)] : [],
      blurb: text("textSpecies", "blurb.species"),
      // The importer hides each entry's description behind a [+]; players were
      // choosing from a list of names without knowing it was there.
      expandHint
    },
    {
      key: "background",
      label: t("step.background"),
      actionLabel: t("stepAcc.background"),
      icon: "fa-scroll",
      help: t("help.background") + importFlowNote(actor),
      removable: true,
      done: !!background,
      entries: background ? [entryFor(background)] : [],
      blurb: text("textBackground", "blurb.background"),
      expandHint
    },
    {
      key: "abilities",
      label: t("step.abilities"),
      actionLabel: t("stepAcc.abilities"),
      icon: "fa-dice-d20",
      help: t("help.abilities"),
      removable: false,
      done: abilitiesDone,
      result: abilitiesDone
        ? Object.entries(actor.system?.abilities ?? {})
            .map(([, v]) => v.value)
            .join(" / ")
        : "",
      summary: abilityMethod,
      img: "",
      blurb: text("textAbilities", "blurb.abilities")
    },
    {
      key: "languages",
      label: t("step.languages"),
      actionLabel: t("stepAcc.languages"),
      icon: "fa-comments",
      help: t("help.languages"),
      removable: false,
      action: "languages",
      // Same reasoning as the ability scores: what is on the sheet counts,
      // whoever put it there.
      done: !!actor.getFlag(MODULE_ID, "languages") || languageCount > 0,
      result: languageHeadline,
      summary: languageSummary,
      img: "",
      blurb: text("textLanguages", "blurb.languages")
    },
    {
      key: "portrait",
      label: t("step.portrait"),
      actionLabel: t("stepAcc.portrait"),
      icon: "fa-image",
      removable: false,
      optional: true,
      action: "setPortrait",
      done: hasPortrait,
      result: hasPortrait ? t("guide.portraitSet") : "",
      img: hasPortrait ? actor.img : "",
      blurb: text("textPortrait", "blurb.portrait")
    }
  ].map((step, index) => ({ ...step, number: index + 2 }));

  return steps;
}
