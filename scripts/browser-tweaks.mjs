/**
 * browser-tweaks.mjs
 * ---------------------------------------------------------------------------
 * The system's Compendium Browser attaches its rich tooltip to the whole result
 * row, so the popup covers the selection checkbox on the right. This moves the
 * tooltip attributes onto the item's name/icon only, leaving the rest of the row
 * - including the checkbox - free.
 *
 * This reaches into another package's DOM, so it is deliberately defensive and
 * can be switched off. If the system changes its markup the tweak simply stops
 * applying; nothing breaks.
 */

import { MODULE_ID } from "./constants.mjs";

/** Selectors we try, in order, to find the name/icon area of a row. */
const NAME_SELECTORS = [
  ".name",
  ".item-name",
  ".entry-name",
  ".title",
  "h4",
  "h3",
  ".details",
  "img"
];

function retargetRow(row) {
  if (row.dataset.pk5eTooltip) return;

  const tooltipAttrs = Array.from(row.attributes).filter((a) =>
    a.name.startsWith("data-tooltip")
  );
  if (!tooltipAttrs.length) return;

  let target = null;
  for (const selector of NAME_SELECTORS) {
    target = row.querySelector(selector);
    if (target) break;
  }
  if (!target || target === row) return;

  for (const attr of tooltipAttrs) {
    target.setAttribute(attr.name, attr.value);
    row.removeAttribute(attr.name);
  }
  // The tooltip content is resolved from the document reference.
  if (row.dataset.uuid && !target.dataset.uuid) target.dataset.uuid = row.dataset.uuid;
  if (row.dataset.itemId && !target.dataset.itemId) target.dataset.itemId = row.dataset.itemId;

  row.dataset.pk5eTooltip = "moved";
}

function retargetAll(root) {
  root
    .querySelectorAll("[data-tooltip], [data-tooltip-html], [data-tooltip-text]")
    .forEach(retargetRow);
}

export function registerBrowserTweaks() {
  Hooks.on("renderCompendiumBrowser", (app, html) => {
    if (!game.settings.get(MODULE_ID, "narrowBrowserTooltips")) return;

    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;

    try {
      retargetAll(root);

      // Results load lazily as the list is scrolled, so keep watching.
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) retargetAll(node);
          }
        }
      });
      observer.observe(root, { childList: true, subtree: true });

      const stop = () => observer.disconnect();
      const originalClose = app.close?.bind(app);
      if (originalClose) {
        app.close = async (...args) => {
          stop();
          return originalClose(...args);
        };
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not adjust Compendium Browser tooltips`, err);
    }
  });
}
