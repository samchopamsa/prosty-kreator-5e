/**
 * compendium.mjs
 * ---------------------------------------------------------------------------
 * Reading classes and subclasses out of the compendiums, and matching an entry
 * the importer highlighted against them.
 *
 * Split out of reference.mjs so both reading windows share one implementation.
 * They present the same data very differently - a wide folder tree in one, a
 * narrow dropdown in the other - but "what is in the compendiums" and "what
 * does this entry say" must not drift apart between them.
 *
 * MATCHING, and why it is this short
 * ----------------------------------
 * Measured against a real library of 127 importer entries: exact name within
 * the same parent class matched every one of them. Normalising names and
 * matching on one name containing another added nothing, and containment
 * actively misfired - "Twilight Domain" matched "Light Domain", because one
 * name really does contain the other. So the rule is exact name plus parent
 * class, and nothing else.
 *
 * SOURCE CODES
 * ------------
 * system.source.book holds a human label ("PHB 2024", "TCoE") that does not
 * line up with the codes the importer shows ("XPHB", "TCE"). The canonical code
 * is in the importer's source flag, and that is what we compare. It is only ever a
 * tie-breaker: the name is the key.
 */

import { MODULE_ID, IMPORTER_FLAG } from "./constants.mjs";
import { referencePackIds } from "./reference-config.mjs";

const WANTED_TYPES = ["class", "subclass"];

/** Lower case, letters and digits only. For comparing identifiers to names. */
export function normalise(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Everything the reading windows need, from the index alone.
 *
 * The index carries name, parent class and source code, so building the list
 * costs one index read per compendium. Full documents are fetched only for the
 * one entry the reader actually opens.
 */
export async function loadClassIndex() {
  const entries = [];

  for (const packId of referencePackIds()) {
    const pack = game.packs.get(packId);
    if (!pack || pack.documentName !== "Item") continue;

    let index;
    try {
      index = await pack.getIndex({
        fields: [
          "system.identifier",
          "system.classIdentifier",
          "system.source",
          `flags.${IMPORTER_FLAG}.source`,
          "folder"
        ]
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not index ${packId}`, err);
      continue;
    }

    for (const entry of index) {
      if (!WANTED_TYPES.includes(entry.type)) continue;

      const source = entry.system?.source ?? {};
      const isClass = entry.type === "class";

      entries.push({
        uuid: `Compendium.${pack.collection}.${entry._id}`,
        name: entry.name,
        type: entry.type,
        img: entry.img || "icons/svg/book.svg",
        // Which class this belongs to. A class belongs to itself.
        classId: isClass
          ? entry.system?.identifier || normalise(entry.name)
          : entry.system?.classIdentifier || "",
        // Canonical book code, comparable with the importer's.
        code: entry.flags?.[IMPORTER_FLAG]?.source ?? "",
        // Human label, for showing the reader where this came from.
        origin: source.book || source.custom || pack.metadata.label,
        packId: pack.collection,
        packLabel: pack.metadata.label
      });
    }
  }

  return entries;
}

/**
 * Groups a flat index into classes with their subclasses beneath.
 *
 * Grouped by classIdentifier rather than by folder, so it does not depend on
 * anyone having tidied the compendium into folders first - and it uses the same
 * field the importer exposes as title="Class: ...", so both sides of a match
 * speak the same language.
 *
 * Subclasses whose class is missing from the compendiums still get a group, so
 * they remain reachable. The heading falls back to the identifier, tidied up.
 */
export function groupByClass(entries) {
  const groups = new Map();

  const groupFor = (classId) => {
    const key = normalise(classId) || "__unknown__";
    if (!groups.has(key)) {
      groups.set(key, { key, classId, name: null, entry: null, subclasses: [] });
    }
    return groups.get(key);
  };

  for (const entry of entries) {
    if (entry.type !== "class") continue;
    const group = groupFor(entry.classId);
    group.name = entry.name;
    group.entry = entry;
  }

  for (const entry of entries) {
    if (entry.type !== "subclass") continue;
    groupFor(entry.classId).subclasses.push(entry);
  }

  const byName = (a, b) => a.name.localeCompare(b.name);

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      name: group.name ?? titleFromIdentifier(group.classId),
      subclasses: group.subclasses.sort(byName)
    }))
    .filter((group) => group.entry || group.subclasses.length)
    .sort(byName);
}

/** "path-of-the-berserker" -> "Path Of The Berserker". A last resort only. */
function titleFromIdentifier(identifier) {
  const text = String(identifier ?? "").replace(/[-_]+/g, " ").trim();
  if (!text) return "Other";
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Finds the compendium entry for something highlighted in the importer.
 *
 * @param {Array}  entries  Index from loadClassIndex().
 * @param {object} picked   { name, type, parentName, code } read off the row.
 * @returns {object|null}
 */
export function matchImporterEntry(entries, picked) {
  if (!picked?.name) return null;

  const wantedName = picked.name.trim();
  const sameType = entries.filter((e) => e.type === picked.type);

  // A class matches on its own name. A subclass must also belong to the class
  // the importer named, so a Cleric domain can never match a Druid circle.
  let candidates;
  if (picked.type === "class") {
    candidates = sameType.filter((e) => e.name === wantedName);
  } else {
    const wantedClass = classIdForName(entries, picked.parentName);
    candidates = sameType.filter(
      (e) => e.name === wantedName && normalise(e.classId) === wantedClass
    );
  }

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  // Only reached when two compendiums hold the same entry. The book code
  // decides; failing that, the first one wins and the window names the
  // compendium it is showing.
  return candidates.find((e) => e.code && e.code === picked.code) ?? candidates[0];
}

/**
 * The importer names the parent class ("Artificer"); the compendium stores an
 * identifier ("artificer"). Prefer a real class entry, fall back to the
 * normalised name - which is what the identifier almost always is anyway.
 */
export function classIdForName(entries, name) {
  const wanted = normalise(name);
  if (!wanted) return "";
  const match = entries.find((e) => e.type === "class" && normalise(e.name) === wanted);
  return normalise(match?.classId ?? wanted);
}

/**
 * Readable description of one entry.
 *
 * Illustrations are stripped: artwork from books the reader does not own comes
 * through as a padlock, which is worse than no picture at all.
 */
export async function readDescription(uuid) {
  const doc = await fromUuid(uuid);
  const raw = doc?.system?.description?.value ?? "";
  if (!raw) return null;

  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  const html = await TE.enrichHTML(raw, { relativeTo: doc, secrets: false });

  return html
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
    .replace(/<img\b[^>]*>/gi, "");
}
