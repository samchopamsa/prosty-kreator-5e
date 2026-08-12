/**
 * sources.mjs
 * ---------------------------------------------------------------------------
 * Odpowiada za czytanie danych z kompendiow.
 *
 * ZASADA: modul NIE ma zaszytych na sztywno zadnych paczek. Skanuje wszystkie
 * kompendia z przedmiotami (Item) dostepne w swiecie i pozwala GM-owi wybrac,
 * ktore z nich sa "wlaczonymi zrodlami". Dzieki temu zadziala tak samo z SRD,
 * z kompendiami swiata, jak i z czymkolwiek zaimportowanym.
 */

export const MODULE_ID = "prosty-kreator-5e";

/**
 * Mapowanie "kroku kreatora" na typy przedmiotow systemu dnd5e.
 * Gatunek historycznie ma typ "race" - trzymamy oba warianty na wszelki wypadek.
 */
export const ITEM_TYPES = {
  species: ["race", "species"],
  background: ["background"],
  class: ["class"]
};

/** Wszystkie kompendia zawierajace przedmioty. */
export function getItemPacks() {
  return game.packs.filter((p) => p.documentName === "Item");
}

/**
 * Lista ID wlaczonych paczek.
 * Jesli GM nic jeszcze nie wybral, domyslnie bierzemy kompendia systemowe (SRD).
 */
export function getEnabledPackIds() {
  const saved = game.settings.get(MODULE_ID, "enabledPacks") ?? [];
  if (Array.isArray(saved) && saved.length) return saved;
  return getItemPacks()
    .filter((p) => p.metadata.packageType === "system")
    .map((p) => p.collection);
}

/** Model danych dla listy checkboxow w kroku "Zrodla". */
export function getPackChoices() {
  const enabled = new Set(getEnabledPackIds());
  return getItemPacks()
    .map((p) => ({
      id: p.collection,
      label: p.metadata.label,
      origin:
        p.metadata.packageType === "system"
          ? "System (SRD)"
          : p.metadata.packageType === "world"
            ? "Swiat"
            : `Modul: ${p.metadata.packageName ?? "?"}`,
      checked: enabled.has(p.collection)
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin) || a.label.localeCompare(b.label));
}

/**
 * Zwraca posortowana liste wpisow danego rodzaju ze wszystkich wlaczonych paczek.
 * Czytamy indeks (szybki), a nie pelne dokumenty.
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
        fields: ["system.identifier", "system.source.book", "system.source.custom"]
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Nie udalo sie odczytac indeksu paczki ${packId}`, err);
      continue;
    }

    for (const entry of index) {
      if (!types.includes(entry.type)) continue;
      results.push({
        uuid: `Compendium.${pack.collection}.${entry._id}`,
        name: entry.name,
        img: entry.img || "icons/svg/item-bag.svg",
        packLabel: pack.metadata.label,
        book: entry.system?.source?.book ?? entry.system?.source?.custom ?? "",
        search: `${entry.name} ${pack.metadata.label}`.toLowerCase()
      });
    }
  }

  results.sort((a, b) => a.name.localeCompare(b.name, game.i18n?.lang ?? "pl"));
  return results;
}

/** Bezpieczne pobranie wzbogaconego HTML opisu (dziala na v13 i v14). */
export async function getDescriptionHTML(uuid) {
  try {
    const doc = await fromUuid(uuid);
    if (!doc) return null;
    const raw = doc.system?.description?.value ?? "";
    if (!raw) return "<p><em>Brak opisu w kompendium.</em></p>";
    const TE =
      foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    return await TE.enrichHTML(raw, { relativeTo: doc, secrets: false });
  } catch (err) {
    console.warn(`${MODULE_ID} | Nie udalo sie przygotowac opisu dla ${uuid}`, err);
    return null;
  }
}
