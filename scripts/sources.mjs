/**
 * sources.mjs
 * ---------------------------------------------------------------------------
 * Reads data from compendiums.
 *
 * PRINCIPLE: no pack is hard-coded. We scan every Item compendium available in
 * the world and let the GM decide which ones count as enabled sources. That way
 * SRD, world compendiums and anything imported behave identically.
 */

export const MODULE_ID = "prosty-kreator-5e";

/**
 * Wizard step -> dnd5e item types.
 * Species historically uses the "race" type; we accept both spellings.
 */
export const ITEM_TYPES = {
  species: ["race", "species"],
  background: ["background"],
  class: ["class"]
};

/** Every compendium holding Items. */
export function getItemPacks() {
  return game.packs.filter((p) => p.documentName === "Item");
}

/** Human readable origin of a pack. */
export function packOrigin(pack) {
  switch (pack.metadata.packageType) {
    case "system":
      return "System (SRD)";
    case "world":
      return "World";
    default:
      return `Module: ${pack.metadata.packageName ?? "?"}`;
  }
}

/**
 * Folder path of a compendium, e.g. "Plutonium / Sources / PHB".
 * Compendium folders exist in Foundry v13+; falls back to the origin label.
 */
export function packGroupLabel(pack) {
  let node = pack.folder;
  if (!node) return packOrigin(pack);
  const names = [];
  const guard = new Set();
  while (node && !guard.has(node.id)) {
    guard.add(node.id);
    names.unshift(node.name);
    node = node.folder ?? null;
  }
  return names.join(" / ") || packOrigin(pack);
}

/**
 * Enabled pack ids. If the GM has not chosen yet, default to system packs (SRD).
 */
export function getEnabledPackIds() {
  const saved = game.settings.get(MODULE_ID, "enabledPacks") ?? [];
  if (Array.isArray(saved) && saved.length) return saved;
  return getItemPacks()
    .filter((p) => p.metadata.packageType === "system")
    .map((p) => p.collection);
}

/** Packs grouped by folder, for the source configuration screen. */
export function getPackGroups() {
  const enabled = new Set(getEnabledPackIds());
  const groups = new Map();

  for (const pack of getItemPacks()) {
    const key = packGroupLabel(pack);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      id: pack.collection,
      label: pack.metadata.label,
      origin: packOrigin(pack),
      checked: enabled.has(pack.collection)
    });
  }

  return Array.from(groups.entries())
    .map(([label, packs]) => {
      packs.sort((a, b) => a.label.localeCompare(b.label));
      return {
        label,
        packs,
        count: packs.length,
        checkedCount: packs.filter((p) => p.checked).length
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Which rules edition an entry belongs to: "2024", "2014" or "".
 * dnd5e stores this in system.source.rules; we fall back to reading the book.
 */
export function detectRules(source = {}) {
  const raw = source.rules ?? "";
  if (raw) return String(raw);
  const book = `${source.book ?? ""} ${source.custom ?? ""}`;
  if (/5\.2|2024|XPHB|XDMG|XMM/i.test(book)) return "2024";
  if (/5\.1|2014|\bPHB\b|\bDMG\b/i.test(book)) return "2014";
  return "";
}

/**
 * Sorted entries of a given kind, from every enabled pack.
 * Reads the compendium index rather than full documents, for speed.
 */
export async function getEntries(kind) {
  const types = ITEM_TYPES[kind];
  if (!types) return [];

  const results = [];
  for (const packId of getEnabledPackIds()) {
    const pack = game.packs.get(packId);
    if (!pack || pack.documentName !== "Item") continue;

    let index;
    try {
      index = await pack.getIndex({
        fields: [
          "system.identifier",
          "system.source.book",
          "system.source.custom",
          "system.source.rules"
        ]
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read index of pack ${packId}`, err);
      continue;
    }

    for (const entry of index) {
      if (!types.includes(entry.type)) continue;
      const source = entry.system?.source ?? {};
      const rules = detectRules(source);
      const book = source.book || source.custom || "";
      results.push({
        uuid: `Compendium.${pack.collection}.${entry._id}`,
        name: entry.name,
        img: entry.img || "icons/svg/item-bag.svg",
        packLabel: pack.metadata.label,
        book,
        rules,
        hasRules: !!rules,
        origin: book || pack.metadata.label,
        search: `${entry.name} ${pack.metadata.label} ${book} ${rules}`.toLowerCase()
      });
    }
  }

  results.sort(
    (a, b) =>
      a.name.localeCompare(b.name, game.i18n?.lang ?? "en") ||
      a.packLabel.localeCompare(b.packLabel)
  );
  return results;
}

/**
 * Enriched description HTML. Artwork is stripped by default because SRD text
 * often links to images from premium modules the user may not own, which Foundry
 * renders as a padlock placeholder.
 */
export async function getDescriptionHTML(uuid) {
  try {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const raw = doc.system?.description?.value ?? "";
    if (!raw) return "<p><em>No description in the compendium.</em></p>";

    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    let html = await TE.enrichHTML(raw, { relativeTo: doc, secrets: false });

    if (!game.settings.get(MODULE_ID, "showArtwork")) {
      html = html
        .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
        .replace(/<img\b[^>]*>/gi, "");
    }
    return html;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not build description for ${uuid}`, err);
    return null;
  }
}
