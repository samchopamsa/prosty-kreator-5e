/**
 * rules-data.mjs
 * ---------------------------------------------------------------------------
 * Reading the rules themselves, rather than watching what the importer does.
 *
 * WHY
 * ---
 * Everything the module knows today it learned by watching: which dialog opened,
 * which advancement entry came back empty, what changed on the sheet between two
 * readings. That works, but only while a window of ours is open, and it can only
 * ever report what already happened.
 *
 * The importer loads its rules data libraries into the page, and they are the
 * same libraries the importer itself reads. So we can ask the rules directly:
 * what is a Fighter meant to gain at level 1? Then compare that against the
 * character, at any moment, whether or not anybody was watching at the time.
 *
 * WHAT THE DATA ACTUALLY LOOKS LIKE
 * ---------------------------------
 * Measured in a live world rather than assumed, because the shape differs from
 * the raw files on disk:
 *
 *   DataUtil.class.loadJSON()  ->  { class: [30], subclass: [322] }
 *
 * The features come back ALREADY RESOLVED. The files on disk store references
 * ("Second Wind|Fighter|XPHB|1") and a separate classFeature array, but by the
 * time loadJSON() returns, cls.classFeatures holds the real objects, each with
 * name, level and entries. There is no top-level classFeature array and no
 * dereferencing step to call - the API is only loadJSON, loadRawJSON,
 * loadUnmergedJSON, loadBrew, loadPrerelease and pGetSubclassLookup.
 *
 * cls.classFeatures is an array of arrays, one per level. We do not trust that
 * index: every feature carries its own `level`, so we filter on that instead.
 * An index is a guess about ordering; the field is the answer.
 *
 * SOURCES ARE NOT OPTIONAL HERE
 * -----------------------------
 * The data carries every edition at once - PHB (2014), XPHB (2024), TCE, EFA and
 * stray UA. The world's blocklist does not apply: that restricts compendiums,
 * and this is not a compendium. Asking for "Fighter" without saying which one
 * quietly returns the 2014 class, which is the wrong answer for this table and
 * the kind of wrong that looks right. So source is always explicit, defaulting
 * to the order in SOURCE_PREFERENCE.
 *
 * NOTHING HERE TOUCHES A CHARACTER
 * --------------------------------
 * This file only reads. It has no opinion about what should happen next, which
 * keeps it testable without Foundry and keeps the "am I reading the rules right"
 * question separate from "what should I do about it".
 */

import { MODULE_ID, IMPORTER_FLAG } from "./constants.mjs";
import { trace } from "./trace.mjs";

/**
 * Which book wins when a class exists in several.
 *
 * XPHB first because the table is a 2024 game; EFA next for the Artificer,
 * which lives nowhere else. PHB is listed last rather than omitted: better to
 * return the 2014 class, clearly labelled, than to return nothing at all.
 */
export const SOURCE_PREFERENCE = ["XPHB", "EFA", "TCE", "PHB"];

/** Loaded once. The libraries cache internally too, but this saves the await. */
let cache = null;
let pending = null;

/** Whether the importer's rules libraries are on the page at all. */
export function isAvailable() {
  return typeof globalThis.DataUtil?.class?.loadJSON === "function";
}

/**
 * The class and subclass data, or null if the libraries are not there.
 *
 * Never throws: without the importer this module simply has nothing to say, and
 * every caller is an extra on top of something that already works.
 */
export async function loadRules() {
  if (cache) return cache;
  if (pending) return pending;
  if (!isAvailable()) return null;

  pending = (async () => {
    try {
      const api = globalThis.DataUtil.class;

      // Three sources, because a world's list of books is its own. loadJSON is
      // the official data; brew is what the GM has added (Northlands, Griffon's
      // Saddlebag, anything from the importer's source list); prerelease is
      // Unearthed Arcana. The importer offers all of them side by side, so a
      // panel that only knows the first has nothing to say about exactly the
      // entries a player is least likely to recognise.
      const loaders = [
        api.loadJSON?.(),
        api.loadBrew?.().catch(() => null),
        api.loadPrerelease?.().catch(() => null)
      ];
      const parts = (await Promise.all(loaders)).filter(Boolean);

      cache = {
        classes: parts.flatMap((part) => (Array.isArray(part.class) ? part.class : [])),
        subclasses: parts.flatMap((part) => (Array.isArray(part.subclass) ? part.subclass : []))
      };

      trace(
        `rules data: ${cache.classes.length} classes, ${cache.subclasses.length} subclasses ` +
          `from ${parts.length} source set(s)`
      );
      return cache;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read the importer's class data`, err);
      return null;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/** Forgets the loaded data. For the console, and for tests. */
export function clearCache() {
  cache = null;
  pending = null;
}

// --- pure lookups -----------------------------------------------------------
//
// Everything below takes data as an argument rather than reaching for the
// globals, so it can be tested against fixtures.

const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * One class by name, preferring the newest book that has it.
 *
 * @param {object[]} classes   the `class` array from loadRules()
 * @param {string}   name      "Fighter"
 * @param {string}   [source]  "XPHB" to insist; omitted to take the preference
 */
export function selectClass(classes, name, source = null) {
  const matches = (classes ?? []).filter((c) => same(c.name, name));
  if (!matches.length) return null;
  if (source) return matches.find((c) => same(c.source, source)) ?? null;

  for (const preferred of SOURCE_PREFERENCE) {
    const found = matches.find((c) => same(c.source, preferred));
    if (found) return found;
  }
  // An unlisted book is still better than nothing - homebrew lands here.
  return matches[0];
}

/**
 * One subclass, matched on its parent class as well as its own name.
 *
 * Subclass names repeat across classes far more than one expects, and the
 * parent is stored as className/classSource rather than being derivable from
 * the name.
 */
export function selectSubclass(subclasses, className, subclassName, source = null) {
  const matches = (subclasses ?? []).filter(
    (s) =>
      same(s.className, className) &&
      (same(s.name, subclassName) || same(s.shortName, subclassName))
  );
  if (!matches.length) return null;
  if (source) return matches.find((s) => same(s.source, source)) ?? null;

  for (const preferred of SOURCE_PREFERENCE) {
    const found = matches.find((s) => same(s.source, preferred));
    if (found) return found;
  }
  return matches[0];
}

/**
 * Features granted at exactly this level.
 *
 * Filtered on each feature's own `level` rather than on its position in the
 * array of arrays. The two agree in the data as it stands, but only one of them
 * is a promise.
 */
export function featuresAtLevel(cls, level) {
  const groups = cls?.classFeatures;
  if (!Array.isArray(groups)) return [];

  const wanted = Number(level);
  const flat = [];
  for (const group of groups) {
    // A group is normally an array of features; tolerate a bare object.
    for (const feature of Array.isArray(group) ? group : [group]) {
      if (feature && typeof feature === "object") flat.push(feature);
    }
  }

  return flat.filter((f) => Number(f.level) === wanted).map(describeFeature);
}

/**
 * Subclass features at a level.
 *
 * NOT the same shape as classFeatures, which is the trap here. A class level
 * holds its features directly. A subclass level holds a WRAPPER, and the real
 * features are nested inside its entries:
 *
 *   level 3  { name: "Battle Master", entries: [
 *               "Master Sophisticated Battle Maneuvers",   <- fluff
 *               { name: "Combat Superiority", __prop: "subclassFeature", ... },
 *               { name: "Student of War",     __prop: "subclassFeature", ... },
 *               { name: "Maneuver Options",   __prop: "subclassFeature", ... } ] }
 *
 *   level 7  { level: 7, header: 2, entries: [                <- NO name at all
 *               { name: "Know Your Enemy", __prop: "subclassFeature", ... } ] }
 *
 * Reading the wrapper would report "Battle Master" at level 3 - the subclass's
 * own name rather than anything gained - and an empty string at level 7, which
 * is how this was caught.
 *
 * So we take the deepest named subclassFeature on each branch. Only `__prop`
 * is followed: Combat Superiority's own sub-headings (Maneuvers, Superiority
 * Dice) carry no __prop and stay part of its text, and the maneuver list inside
 * Maneuver Options is `optionalfeature`, which is a menu to choose from rather
 * than something the level grants.
 */
export function subclassFeaturesAtLevel(subclass, level) {
  const groups = subclass?.subclassFeatures;
  if (!Array.isArray(groups)) return [];

  const wanted = Number(level);
  const found = [];

  for (const group of groups) {
    for (const wrapper of Array.isArray(group) ? group : [group]) {
      if (!wrapper || typeof wrapper !== "object") continue;
      if (Number(wrapper.level) !== wanted) continue;
      found.push(...deepestFeatures(wrapper));
    }
  }

  return found.map(describeFeature);
}

/**
 * The shape every feature is reported in.
 *
 * The hash is computed here rather than by the caller, because it needs fields
 * (className, classSource, subclassShortName) that are on the raw feature and
 * would otherwise have to be carried around just in case.
 */
function describeFeature(f) {
  return {
    name: f.name ?? "",
    level: Number(f.level),
    source: f.source ?? "",
    entries: Array.isArray(f.entries) ? f.entries : [],
    // Features that only mark a decision point read oddly on their own, so
    // callers can tell them apart from ones with real text.
    isGainSubclass: Boolean(f.gainSubclassFeature),
    hash: featureHash(f),
    choice: choiceIn(f),
    isPhantom: isPhantomFeature(f)
  };
}

/**
 * A feature that never becomes an item on the sheet.
 *
 * Two kinds, both found by comparing a finished character against the rules:
 *
 * "Ability Score Improvement" raises numbers or grants a feat of the player's
 * choosing. What lands on the sheet is a changed score or an item named after
 * the chosen feat - never an item by this name, in any class, at any level.
 *
 * Resource-shaped entries like "Superiority Die" arrive as a resource with no
 * flags at all rather than as a feature.
 *
 * Expecting either would mean reporting a permanent, unfixable gap on every
 * character that reaches the level.
 */
function isPhantomFeature(f) {
  const name = String(f?.name ?? "").toLowerCase();
  if (/^ability score improvement/.test(name)) return true;
  // Feats taken instead of an ASI are the player's choice, not a fixed grant.
  if (/^(epic boon|ability score)/.test(name)) return true;
  return false;
}

/**
 * The choice a feature contains, if it contains one.
 *
 * "Maneuver Options" is not something a character can hold - it is twenty
 * maneuvers with an instruction to take three. In the data that is a nested
 * block of `type: "options"` carrying a `count`. On the sheet it appears as
 * that many separate items, tagged by the importer as `optionalfeatures.html`.
 *
 * So the useful question is not "is Maneuver Options present" - it never can
 * be - but "were three of them chosen".
 */
function choiceIn(f) {
  const walk = (entries) => {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.type === "options") {
        return {
          count: Number(entry.count) || 1,
          options: (Array.isArray(entry.entries) ? entry.entries : [])
            .map((option) => option?.name)
            .filter(Boolean)
        };
      }
      const nested = walk(entry.entries);
      if (nested) return nested;
    }
    return null;
  };
  return walk(f?.entries);
}

/**
 * The subclass's own introduction, as the book prints it.
 *
 * Subclasses have no separate description: the text that says what one is
 * about lives inside the wrapper for the level it arrives at, ahead of the
 * features. Battle Master's reads
 *
 *   "{@i Master Sophisticated Battle Maneuvers}"
 *   "Battle Masters are students of the art of battle, learning martial
 *    techniques passed down through generations."
 *
 * subclassFeaturesAtLevel() walks past this on its way to the named features,
 * which is right for checking a character and wrong for describing one to a
 * player deciding between twelve of them.
 *
 * Only plain strings are taken - anything with a __prop is a feature in its own
 * right and gets reported separately.
 */
export function subclassIntro(subclass) {
  const groups = subclass?.subclassFeatures;
  if (!Array.isArray(groups)) return [];

  // The earliest wrapper, since that is where the introduction sits; later
  // levels carry features and nothing introductory.
  const wrappers = groups
    .flatMap((group) => (Array.isArray(group) ? group : [group]))
    .filter((wrapper) => wrapper && typeof wrapper === "object")
    .sort((a, b) => Number(a.level ?? 99) - Number(b.level ?? 99));

  const first = wrappers[0];
  if (!first) return [];

  return (Array.isArray(first.entries) ? first.entries : []).filter(
    (entry) => typeof entry === "string"
  );
}

/**
 * A feature's nested subclassFeature children, or itself when it has none.
 *
 * Recursive rather than one level deep: nothing promises the nesting stops at
 * two, and a wrapper inside a wrapper would otherwise be reported as the gain.
 */
function deepestFeatures(feature) {
  const children = (Array.isArray(feature.entries) ? feature.entries : []).filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      entry.__prop === "subclassFeature" &&
      entry.name
  );

  if (!children.length) {
    // An unnamed wrapper with nothing named inside it says nothing worth
    // showing, so it is dropped rather than reported as a blank line.
    return feature.name ? [feature] : [];
  }

  return children.flatMap(deepestFeatures);
}

/**
 * The starting equipment options, in a form worth showing.
 *
 * defaultData is one object of lettered choices: { A: [...], B: [...], C: [...] }.
 * Coins appear as { value: 400 }, in copper - 400 is the 4 GP the printed text
 * quotes. Items appear as { item: "chain mail|xphb", quantity: 8 }, where the
 * part after the pipe is the source and not part of the name.
 */
export function equipmentOptions(cls) {
  const blocks = cls?.startingEquipment?.defaultData;
  if (!Array.isArray(blocks)) return [];

  const options = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    for (const [letter, contents] of Object.entries(block)) {
      if (!Array.isArray(contents)) continue;

      const items = [];
      let copper = 0;
      for (const line of contents) {
        if (line?.value != null) {
          copper += Number(line.value) || 0;
          continue;
        }
        if (!line?.item) continue;
        const [rawName] = String(line.item).split("|");
        items.push({
          name: titleCase(rawName),
          quantity: Number(line.quantity) || 1
        });
      }

      options.push({ letter, items, gold: copper / 100 });
    }
  }
  return options;
}

/** "chain mail" -> "Chain Mail". The data stores these lowercased. */
function titleCase(text) {
  return String(text)
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

// --- turning entries into something readable --------------------------------

/**
 * Strips the importer's markup down to plain text.
 *
 * The fallback for when Renderer is unavailable or throws. Tags are
 * {@tag display|source|displayText}: the third part overrides the first where
 * it exists, so "{@item Arrows (20)|XPHB|20 Arrows}" reads as "20 Arrows".
 * {@filter} is the exception - its later parts are query syntax, never text.
 */
export function stripTags(text) {
  let out = String(text ?? "");
  let last;
  // Looped because tags nest: the inner ones have to go first.
  do {
    last = out;
    out = out.replace(/\{@(\w+) ([^{}]*)\}/g, (match, tag, body) => {
      const parts = body.split("|");
      if (tag === "filter") return parts[0];
      return parts[2] || parts[0];
    });
  } while (out !== last);
  return out.trim();
}

/**
 * A feature's text as HTML, via the importer's own renderer where possible.
 *
 * The renderer is what produces the links and dice buttons the rest of
 * the importer's windows show, so using it keeps the panel looking like its
 * surroundings. When it is missing or unhappy, plain paragraphs of stripped
 * text still say the same thing.
 */
export function renderEntries(entries) {
  const list = Array.isArray(entries) ? entries : [entries];

  try {
    const renderer = globalThis.Renderer?.get?.();
    if (renderer) {
      const parts = [];
      renderer.setFirstSection(true).recursiveRender({ type: "entries", entries: list }, parts);
      const html = parts.join("");
      if (html.trim()) return html;
    }
  } catch (err) {
    trace("Renderer refused an entry, falling back to plain text", err);
  }

  return list
    .filter((entry) => typeof entry === "string")
    .map((entry) => `<p>${escapeHtml(stripTags(entry))}</p>`)
    .join("");
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// --- matching rules to what is on the sheet ---------------------------------

/**
 * The identifier that links a rule to an item on a character.
 *
 * The importer stamps every feature it imports with `the importer's hash flag`, and
 * that hash is computed from the same rules data we are reading. So the two
 * sides can be matched on a key rather than on names, which otherwise differ by
 * source suffixes, punctuation and the occasional rename.
 *
 * Two real examples, read off a live character:
 *
 *   bardic%20inspiration_bard_xphb_1_xphb
 *     name _ className _ classSource _ level _ source
 *
 *   vitality%20of%20the%20tree_barbarian_xphb_world%20tree_xphb_3_xphb
 *     name _ className _ classSource _ subclassShortName _ subclassSource _ level _ source
 *
 * Lowercased throughout, spaces as %20. Note the subclass appears by its
 * shortName ("world tree"), not its full name ("Path of the World Tree").
 *
 * the importer's own UrlUtil is used when present, since it is the thing that
 * actually defines this format; the hand-built version below is the fallback,
 * and the tests pin it against both examples above.
 */
export function featureHash(feature) {
  if (!feature?.name) return null;

  const kind = feature.__prop === "subclassFeature" ? "subclassFeature" : "classFeature";

  try {
    const builder = globalThis.UrlUtil?.URL_TO_HASH_BUILDER?.[kind];
    if (builder) {
      const hash = builder(feature);
      if (hash) return String(hash).toLowerCase();
    }
  } catch (err) {
    trace("UrlUtil could not hash a feature, building it by hand", err);
  }

  const part = (value) => encodeURIComponent(String(value ?? "").toLowerCase());
  const pieces =
    kind === "subclassFeature"
      ? [
          feature.name,
          feature.className,
          feature.classSource,
          feature.subclassShortName,
          feature.subclassSource,
          feature.level,
          feature.source
        ]
      : [feature.name, feature.className, feature.classSource, feature.level, feature.source];

  if (pieces.some((piece) => piece == null || piece === "")) return null;
  return pieces.map(part).join("_");
}

/** Names differ by punctuation and case far more than by content. */
const normaliseName = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Which of the expected features are missing from the character.
 *
 * Both arguments are plain data, so this is testable without Foundry:
 *   expected  - from gainsForLevel()
 *   present   - [{ name, hash }] read off the sheet's items
 *
 * Hash first, name second. The hash is exact, but it is only there on items
 * the importer imported: a character built partly from the system's own
 * compendium has features carrying no flag at all, and those would otherwise
 * all be reported missing. Falling back to the name is less certain, so the
 * result says which way each match was made rather than pretending they are
 * equivalent.
 */
export function missingFeatures(expected, present) {
  const presentHashes = new Set(
    (present ?? []).map((item) => item?.hash).filter(Boolean)
  );
  const presentNames = new Set(
    (present ?? []).map((item) => normaliseName(item?.name)).filter(Boolean)
  );

  const missing = [];
  const matched = [];

  for (const feature of expected ?? []) {
    if (feature.hash && presentHashes.has(feature.hash)) {
      matched.push({ name: feature.name, by: "hash" });
      continue;
    }
    if (presentNames.has(normaliseName(feature.name))) {
      matched.push({ name: feature.name, by: "name" });
      continue;
    }
    missing.push(feature);
  }

  return { missing, matched };
}

/**
 * How many of a choice were actually taken.
 *
 * Matched on the importer's naming convention rather than on the list of options,
 * because the list is per-book and the player is not. A Battle Master whose
 * third maneuver is Brace (from TCE) has made a complete choice, but Brace does
 * not appear in the XPHB "Maneuver Options" list, so checking membership
 * reported 2 of 3 on a finished character.
 *
 * The convention is "<feature name>: <chosen option>", and it holds across the
 * two namespaces the importer uses:
 *
 *   Maneuvers: Ambush            page: optionalfeatures.html
 *   Divine Order: Protector      page: classFeature
 *   Fighting Style: Archery      page: feats.html
 *
 * The prefix is the feature's name minus any trailing "Options", since the
 * container is called "Maneuver Options" while the items say "Maneuvers:".
 *
 * @param {object[]} expected  features from gainsForLevel(), some with .choice
 * @param {object[]} taken     every feature-ish item on the sheet
 */
export function countChoices(expected, taken) {
  const results = [];

  for (const feature of expected ?? []) {
    if (!feature.choice) continue;

    const prefixes = choicePrefixes(feature.name);
    const chosen = (taken ?? []).filter((item) => {
      const name = normaliseName(item?.name);
      return prefixes.some((prefix) => name.startsWith(prefix));
    });

    results.push({
      name: feature.name,
      required: feature.choice.count,
      taken: chosen.length,
      names: chosen.map((item) => item.name),
      isComplete: chosen.length >= feature.choice.count
    });
  }

  return results;
}

/**
 * The name prefixes a chosen item might carry.
 *
 * "Maneuver Options" -> items named "Maneuvers: ...", so the trailing word is
 * dropped and a plural allowed. "Divine Order" -> "Divine Order: ...", which
 * needs no adjustment.
 */
function choicePrefixes(featureName) {
  const base = normaliseName(featureName).replace(/\s+options?$/, "");
  if (!base) return [];
  const forms = new Set([base, `${base}s`]);
  // "maneuver" -> "maneuvers"; harmless where the plural is already right.
  return [...forms].map((form) => `${form} `);
}

/**
 * What a level of a class is meant to give.
 *
 * The one entry point worth calling from a window. Returns null - never throws
 * and never guesses - when the libraries are absent or the class is unknown,
 * because every caller is an addition to something that already works without
 * it.
 *
 * @param {string} className
 * @param {number} level                the class level being gained, not the total
 * @param {object} [options]
 * @param {string} [options.source]     insist on a book
 * @param {string} [options.subclass]   include that subclass's features too
 */
export async function gainsForLevel(className, level, options = {}) {
  const rules = await loadRules();
  if (!rules) return null;

  const cls = selectClass(rules.classes, className, options.source);
  if (!cls) {
    trace(`the rules data has no class named "${className}"`);
    return null;
  }

  const features = featuresAtLevel(cls, level);

  let subclassFeatures = [];
  let subclass = null;
  if (options.subclass) {
    subclass = selectSubclass(rules.subclasses, cls.name, options.subclass, options.source);
    if (subclass) subclassFeatures = subclassFeaturesAtLevel(subclass, level);
    else trace(`the rules data has no subclass "${options.subclass}" for ${cls.name}`);
  }

  return {
    className: cls.name,
    source: cls.source,
    level: Number(level),
    hitDie: cls.hd ? `${cls.hd.number}d${cls.hd.faces}` : null,
    subclassTitle: cls.subclassTitle ?? null,
    subclassName: subclass?.name ?? null,
    features,
    subclassFeatures,
    // Only meaningful at level 1, but cheaper to always carry than to make the
    // caller ask a second question.
    equipment: Number(level) === 1 ? equipmentOptions(cls) : []
  };
}

/**
 * Prints what the rules say about a level, for checking against a real sheet.
 *
 *   characterCreator.rules("Fighter", 1)
 *   characterCreator.rules("Bard", 3, { subclass: "College of Swords" })
 *
 * Wired to the console rather than to a window on purpose: this is the step
 * where we find out whether the reading is right, before anything depends on it.
 */
export async function debugRules(className, level = 1, options = {}) {
  const gains = await gainsForLevel(className, level, options);
  if (!gains) {
    console.warn(
      `${MODULE_ID} | Nothing to report - ` +
        (isAvailable() ? `no class "${className}" in the importer's rules data` : "the importer's rules data is not loaded")
    );
    return null;
  }

  console.group(
    `%c${MODULE_ID} | ${gains.className} (${gains.source}) level ${gains.level}`,
    "color:#7fb069;font-weight:bold"
  );
  console.log("hit die:", gains.hitDie ?? "(not stated)");
  console.log(
    "features:",
    gains.features.length ? gains.features.map((f) => f.name) : "(none at this level)"
  );
  if (gains.subclassName) {
    console.log(
      `${gains.subclassName}:`,
      gains.subclassFeatures.length ? gains.subclassFeatures.map((f) => f.name) : "(none)"
    );
  }
  for (const option of gains.equipment) {
    const items = option.items.map((i) => (i.quantity > 1 ? `${i.quantity}x ${i.name}` : i.name));
    console.log(`equipment ${option.letter}:`, [...items, `${option.gold} GP`].join(", "));
  }
  console.groupEnd();

  return gains;
}

// --- comparing a real character against the rules ---------------------------

/**
 * The two kinds of item a character carries, as far as this comparison cares.
 *
 * The importer tags granted features `classFeature`/`subclassFeature`/`raceFeature`
 * and chosen options `optionalfeatures.html`/`feats.html` - note the extension,
 * which makes the two namespaces impossible to confuse. Items with no flag at
 * all (a character built partly from the system compendium, or a resource like
 * "Superiority Die") fall in with the granted features, where a name match can
 * still find them.
 */
function readSheet(actor) {
  const features = [];
  const chosen = [];

  for (const item of actor.items) {
    if (item.type !== "feat") continue;
    const page = item.flags?.[IMPORTER_FLAG]?.page ?? "";
    const entry = {
      name: item.name,
      hash: item.flags?.[IMPORTER_FLAG]?.hash ?? null,
      subtype: item.system?.type?.subtype ?? ""
    };
    if (page.endsWith(".html")) chosen.push(entry);
    else features.push(entry);
  }

  return { features, chosen };
}

/** The classes on a character, with the level reached in each. */
export function classesOn(actor) {
  return actor.items
    .filter((item) => item.type === "class")
    .map((item) => ({
      name: item.name,
      levels: Number(item.system?.levels) || 0,
      subclass: actor.items.find(
        (other) =>
          other.type === "subclass" &&
          other.system?.classIdentifier === item.system?.identifier
      )?.name ?? null
    }));
}

/**
 * Compares a character against what the rules say a level gives.
 *
 * Refuses rather than guesses when the character has no such class: an empty
 * sheet would otherwise come back as "everything is missing", which reads like
 * a finding and is nothing of the sort. That mistake cost us two rounds of
 * diagnosis, so it is now an explicit refusal.
 */
export async function verifyLevel(actor, className, level, options = {}) {
  if (!actor) return null;

  const onSheet = classesOn(actor).find(
    (cls) => cls.name.toLowerCase() === String(className).toLowerCase()
  );
  if (!onSheet) {
    return {
      refused: `${actor.name} has no levels in ${className}`,
      classesOn: classesOn(actor)
    };
  }

  const gains = await gainsForLevel(className, level, {
    subclass: options.subclass ?? onSheet.subclass,
    source: options.source
  });
  if (!gains) return null;

  const { features: present, chosen } = readSheet(actor);
  const all = [...present, ...chosen];

  const expected = [...gains.features, ...gains.subclassFeatures].filter(
    (feature) =>
      // A signpost saying "pick a subclass", not something that lands anywhere.
      !feature.isGainSubclass &&
      // Never becomes an item, in any class, at any level.
      !feature.isPhantom
  );

  const choices = countChoices(expected, all);
  const { missing, matched } = missingFeatures(expected, present);

  return {
    ...gains,
    matched,
    // A feature that contains a choice is reported by its choice line instead.
    // Some are on the sheet in their own right ("Divine Order", which then also
    // matches by hash) and some never are ("Maneuver Options" is twenty
    // maneuvers and an instruction, not an item). Listing the latter as missing
    // was the bug; suppressing both keeps one clear line per choice.
    missing: missing.filter((feature) => !feature.choice),
    choices
  };
}

/**
 * The whole character, level by level, rather than one level at a time.
 *
 * This is the question actually worth asking - "is this character complete" -
 * and it works for multiclass characters by walking each class up to the level
 * reached in it.
 */
export async function verifyCharacter(actor, options = {}) {
  if (!actor) return null;

  const classes = classesOn(actor);
  if (!classes.length) {
    return { refused: `${actor.name} has no class`, levels: [] };
  }

  const levels = [];
  for (const cls of classes) {
    for (let level = 1; level <= cls.levels; level += 1) {
      const report = await verifyLevel(actor, cls.name, level, {
        subclass: cls.subclass,
        source: options.source
      });
      if (report && !report.refused) levels.push(report);
    }
  }

  return {
    actor: actor.name,
    classes,
    levels,
    missing: levels.flatMap((l) => l.missing.map((f) => ({ ...f, className: l.className }))),
    incompleteChoices: levels.flatMap((l) =>
      l.choices.filter((c) => !c.isComplete).map((c) => ({ ...c, level: l.level }))
    )
  };
}

/** Finds a character by id, or by name when the name is unambiguous. */
function resolveActor(actorRef) {
  const byId = game.actors.get(actorRef);
  if (byId) return { actor: byId };

  const matches = game.actors.filter((a) => a.name === actorRef);
  if (!matches.length) return { error: `No character matching "${actorRef}"` };
  if (matches.length > 1) {
    // Silently taking the first one sent us chasing a phantom bug for two
    // rounds, on a world with six characters all called "New Character".
    return {
      error:
        `${matches.length} characters are called "${actorRef}". Use an id:\n` +
        matches.map((a) => `  ${a.id}  (level ${a.system?.details?.level ?? 0})`).join("\n")
    };
  }
  return { actor: matches[0] };
}

/**
 * Checks a character and prints the result.
 *
 *   characterCreator.verify("3je2eThGuGPTtKV4")                  whole character
 *   characterCreator.verify("3je2eThGuGPTtKV4", "Fighter", 3)    one level
 */
export async function debugVerify(actorRef, className = null, level = null, options = {}) {
  const { actor, error } = resolveActor(actorRef);
  if (error) return void console.warn(`${MODULE_ID} | ${error}`);

  const title = (text) =>
    console.group(`%c${MODULE_ID} | ${text}`, "color:#7fb069;font-weight:bold");

  const printLevel = (report) => {
    console.group(`${report.className} level ${report.level}`);
    for (const match of report.matched) console.log(`  ok   ${match.name}  (${match.by})`);
    for (const feature of report.missing) console.log(`  ??   ${feature.name}`);
    for (const choice of report.choices) {
      const mark = choice.isComplete ? "ok  " : "??  ";
      console.log(
        `  ${mark} ${choice.name}: ${choice.taken} of ${choice.required}` +
          (choice.names.length ? ` - ${choice.names.join(", ")}` : "")
      );
    }
    if (!report.matched.length && !report.missing.length && !report.choices.length) {
      console.log("  (this level grants nothing)");
    }
    console.groupEnd();
  };

  if (className) {
    const report = await verifyLevel(actor, className, level ?? 1, options);
    if (!report) return void console.warn(`${MODULE_ID} | Nothing to compare against`);
    if (report.refused) return void console.warn(`${MODULE_ID} | ${report.refused}`);
    title(actor.name);
    printLevel(report);
    console.groupEnd();
    return report;
  }

  const report = await verifyCharacter(actor, options);
  if (!report) return null;
  if (report.refused) return void console.warn(`${MODULE_ID} | ${report.refused}`);

  title(`${actor.name} - ${report.classes.map((c) => `${c.name} ${c.levels}`).join(", ")}`);
  report.levels.forEach(printLevel);
  const problems = report.missing.length + report.incompleteChoices.length;
  console.log(
    problems
      ? `%c${problems} thing(s) to look at`
      : "%cnothing missing",
    problems ? "color:#d98c3f;font-weight:bold" : "color:#7fb069;font-weight:bold"
  );
  console.groupEnd();

  return report;
}
