/**
 * equipment.mjs
 * ---------------------------------------------------------------------------
 * Starting equipment.
 *
 * The dnd5e Advancement system deliberately does NOT grant starting equipment -
 * it only stores the data. Classes and backgrounds carry system.startingEquipment,
 * a flat list of nodes forming a tree via the `group` field:
 *
 *   group: ""        -> a top level choice the player must resolve
 *   type: "OR"       -> pick exactly one child
 *   type: "AND"      -> take every child
 *   type: "linked"   -> a specific item, key holds its UUID
 *   type: "weapon" / "armor" / "tool" / "focus"
 *                    -> a category, key holds e.g. "martialM" or "shield"
 *   count            -> quantity (null means 1)
 *
 * Classes also carry system.wealth: the gold you may take instead of gear.
 */

import { MODULE_ID, getEnabledPackIds } from "./sources.mjs";

let CANDIDATE_CACHE = null;

/** Item document types worth scanning for equipment candidates. */
const CANDIDATE_TYPES = ["weapon", "equipment", "tool", "consumable", "container"];

export function clearCandidateCache() {
  CANDIDATE_CACHE = null;
}

/**
 * Scans enabled compendiums once and groups physical items by document type and
 * by their system.type.value, which is what startingEquipment keys refer to.
 */
async function getCandidatePool() {
  if (CANDIDATE_CACHE) return CANDIDATE_CACHE;

  const pool = { byType: {}, byCategory: {} };
  for (const packId of getEnabledPackIds()) {
    const pack = game.packs.get(packId);
    if (!pack || pack.documentName !== "Item") continue;

    let index;
    try {
      index = await pack.getIndex({ fields: ["system.type.value", "system.type.baseItem"] });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not index ${packId} for equipment`, err);
      continue;
    }

    for (const entry of index) {
      if (!CANDIDATE_TYPES.includes(entry.type)) continue;
      const record = {
        uuid: `Compendium.${pack.collection}.${entry._id}`,
        name: entry.name,
        img: entry.img,
        docType: entry.type,
        category: entry.system?.type?.value ?? ""
      };
      (pool.byType[entry.type] ??= []).push(record);
      const catKey = `${entry.type}:${record.category}`;
      (pool.byCategory[catKey] ??= []).push(record);
    }
  }

  for (const list of Object.values(pool.byType)) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  for (const list of Object.values(pool.byCategory)) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  CANDIDATE_CACHE = pool;
  return pool;
}

/** Currency keys understood by the system (gp, sp, cp, ep, pp). */
function currencyKeys() {
  const cfg = CONFIG.DND5E?.currencies;
  return cfg ? Object.keys(cfg) : ["pp", "gp", "ep", "sp", "cp"];
}

function isCurrencyNode(node) {
  return node.type === "currency" || currencyKeys().includes(node.key);
}

/** Normalises an id or UUID from CONFIG.DND5E lookups into a full UUID. */
function toUuid(raw) {
  const value = typeof raw === "string" ? raw : (raw?.uuid ?? raw?.id ?? "");
  if (!value) return "";
  return value.startsWith("Compendium.") ? value : `Compendium.dnd5e.items.Item.${value}`;
}

/**
 * Curated candidate ids the system publishes for focuses and tools. Using these
 * is far better than guessing, which previously offered every magic item in the
 * world when a "holy focus" was requested.
 */
function curatedIds(node) {
  const C = CONFIG.DND5E ?? {};
  let source = null;
  if (node.type === "focus") source = C.focusTypes?.[node.key]?.itemIds;
  else if (node.type === "tool") source = C.toolIds ?? null;
  if (!source) return [];
  const values = source instanceof Map ? Array.from(source.values()) : Object.values(source);
  return values.map(toUuid).filter(Boolean);
}

/** Which document type a startingEquipment category node maps to. */
function docTypeFor(nodeType) {
  switch (nodeType) {
    case "weapon":
      return "weapon";
    case "armor":
    case "focus":
      return "equipment";
    case "tool":
      return "tool";
    default:
      return null;
  }
}

/**
 * Candidate items for a category node. Falls back to every item of the right
 * document type when the exact category yields nothing, so the player is never
 * stuck with an empty dropdown.
 */
async function candidatesFor(node) {
  const pool = await getCandidatePool();
  const docType = docTypeFor(node.type);
  if (!docType) return { list: [], fallback: false };

  // 1. Curated list published by the system (focuses, tools).
  const curated = curatedIds(node);
  if (curated.length) {
    const known = new Map(
      Object.values(pool.byType)
        .flat()
        .map((i) => [i.uuid, i])
    );
    const list = [];
    for (const uuid of curated) {
      const hit = known.get(uuid);
      if (hit) {
        list.push(hit);
        continue;
      }
      const doc = await fromUuid(uuid).catch(() => null);
      if (doc) list.push({ uuid, name: doc.name, docType: doc.type, category: "" });
    }
    if (list.length) {
      list.sort((a, b) => a.name.localeCompare(b.name));
      return { list, fallback: false };
    }
  }

  // 2. Exact category match, e.g. weapon:martialM or equipment:shield.
  const exact = pool.byCategory[`${docType}:${node.key}`] ?? [];
  if (exact.length) return { list: exact, fallback: false };

  // 3. Proficiency-level keys covering several concrete categories.
  if (node.type === "weapon" && /^(sim|mar)$/.test(node.key)) {
    const prefix = node.key === "sim" ? "simple" : "martial";
    const merged = (pool.byType.weapon ?? []).filter((i) =>
      String(i.category).startsWith(prefix)
    );
    if (merged.length) return { list: merged, fallback: false };
  }

  // 4. Focus nodes at least stay within focus items rather than all equipment.
  if (node.type === "focus") {
    const foci = pool.byCategory[`${docType}:focus`] ?? [];
    if (foci.length) return { list: foci, fallback: true };
  }

  return { list: pool.byType[docType] ?? [], fallback: true };
}

/** Human label for a category node, e.g. "Any martial melee weapon". */
function categoryLabel(node) {
  const C = CONFIG.DND5E ?? {};
  const lookup =
    C.weaponTypes?.[node.key] ??
    C.weaponProficiencies?.[node.key] ??
    C.armorTypes?.[node.key] ??
    C.toolTypes?.[node.key] ??
    C.focusTypes?.[node.key]?.label ??
    node.key;
  const label = typeof lookup === "string" ? lookup : (lookup?.label ?? node.key);
  return `Any ${String(label).toLowerCase()}`;
}

/**
 * Turns one source item (class or background) into a render-ready plan.
 */
async function planForSource(kind, entry) {
  const doc = await fromUuid(entry.uuid);
  if (!doc) return null;

  const nodes = doc.system?.startingEquipment ?? [];
  if (!nodes.length) return null;

  const childrenOf = (id) =>
    nodes.filter((n) => (n.group ?? "") === id).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  /** Flattens a node into concrete leaves the player will receive. */
  const flatten = async (node) => {
    if (node.type === "AND") {
      const out = [];
      for (const child of childrenOf(node._id)) out.push(...(await flatten(child)));
      return out;
    }
    if (node.type === "OR") {
      // A nested OR is rare; take its first branch rather than nesting the UI.
      const first = childrenOf(node._id)[0];
      return first ? await flatten(first) : [];
    }
    if (node.type === "linked") {
      const item = await fromUuid(node.key).catch(() => null);
      return [
        {
          id: node._id,
          kind: "linked",
          uuid: node.key,
          name: item?.name ?? "Unknown item",
          img: item?.img ?? "icons/svg/item-bag.svg",
          count: node.count ?? 1,
          needsPick: false
        }
      ];
    }
    if (isCurrencyNode(node)) {
      return [
        {
          id: node._id,
          kind: "currency",
          currency: node.key,
          name: `${node.count ?? 0} ${String(node.key).toUpperCase()}`,
          count: node.count ?? 0,
          needsPick: false
        }
      ];
    }

    const { list, fallback } = await candidatesFor(node);
    return [
      {
        id: node._id,
        kind: "category",
        name: categoryLabel(node),
        count: node.count ?? 1,
        // An empty list must never block the wizard.
        needsPick: list.length > 0,
        unavailable: list.length === 0,
        fallback,
        candidates: list.map((c) => ({ uuid: c.uuid, name: c.name }))
      }
    ];
  };

  const groups = [];
  for (const root of childrenOf("")) {
    if (root.type === "OR") {
      const options = [];
      for (const child of childrenOf(root._id)) {
        const parts = await flatten(child);
        options.push({
          id: child._id,
          label: parts
            .map((p) => (p.count > 1 ? `${p.name} x${p.count}` : p.name))
            .join(" + "),
          parts
        });
      }
      groups.push({ id: root._id, isChoice: true, options });
    } else {
      const parts = await flatten(root);
      groups.push({
        id: root._id,
        isChoice: false,
        options: [
          {
            id: root._id,
            label: parts
              .map((p) => (p.count > 1 ? `${p.name} x${p.count}` : p.name))
              .join(" + "),
            parts
          }
        ]
      });
    }
  }

  let wealth = doc.system?.wealth ?? "";
  return {
    kind,
    sourceName: entry.name,
    wealth: String(wealth ?? ""),
    hasWealth: !!wealth,
    groups
  };
}

/** Full plan for the current wizard selections. */
export async function buildEquipmentPlan(wizard) {
  const plan = [];
  for (const kind of ["class", "background"]) {
    const entry = wizard[kind];
    if (!entry) continue;
    try {
      const part = await planForSource(kind, entry);
      if (part) plan.push(part);
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not read starting equipment of ${entry.name}`, err);
    }
  }
  return plan;
}

/**
 * Resolves the player's choices into concrete item data plus a gold total.
 */
export async function resolveEquipment(plan, state) {
  const items = [];
  const currency = {};
  const addCurrency = (key, amount) => {
    if (!amount) return;
    currency[key] = (currency[key] ?? 0) + amount;
  };

  for (const source of plan) {
    if (state.mode?.[source.kind] === "gold") {
      addCurrency("gp", await evaluateWealth(source.wealth));
      continue;
    }

    for (const group of source.groups) {
      const chosenId = group.isChoice
        ? (state.choices?.[group.id] ?? group.options[0]?.id)
        : group.options[0]?.id;
      const option = group.options.find((o) => o.id === chosenId) ?? group.options[0];
      if (!option) continue;

      for (const part of option.parts) {
        if (part.kind === "currency") {
          addCurrency(part.currency, Number(part.count) || 0);
          continue;
        }
        const uuid = part.needsPick ? state.picks?.[part.id] : part.uuid;
        if (!uuid) continue;
        const doc = await fromUuid(uuid).catch(() => null);
        if (!doc) continue;
        const data = doc.toObject();
        delete data._id;
        if (part.count > 1) foundry.utils.setProperty(data, "system.quantity", part.count);
        items.push(data);
      }
    }
  }

  return { items, currency };
}

/** Starting wealth may be a plain number or a dice formula. */
async function evaluateWealth(wealth) {
  if (!wealth) return 0;
  const asNumber = Number(wealth);
  if (Number.isFinite(asNumber)) return asNumber;
  try {
    const roll = await new Roll(String(wealth)).evaluate();
    return roll.total;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not evaluate wealth formula "${wealth}"`, err);
    return 0;
  }
}

/** True when every category choice has a concrete item selected. */
export function equipmentComplete(plan, state) {
  for (const source of plan) {
    if (state.mode?.[source.kind] === "gold") continue;
    for (const group of source.groups) {
      const chosenId = group.isChoice
        ? (state.choices?.[group.id] ?? group.options[0]?.id)
        : group.options[0]?.id;
      const option = group.options.find((o) => o.id === chosenId) ?? group.options[0];
      if (!option) continue;
      for (const part of option.parts) {
        if (part.needsPick && !state.picks?.[part.id]) return false;
      }
    }
  }
  return true;
}
