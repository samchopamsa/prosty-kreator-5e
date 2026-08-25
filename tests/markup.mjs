/**
 * tests/markup.mjs
 * ---------------------------------------------------------------------------
 * Testy tego, co czyta CUDZY markup - dzis okna importera Plutonium.
 *
 * DLACZEGO OSOBNY PLIK
 * --------------------
 * tests/run.mjs nie ma zadnych zaleznosci i to jest jego zaleta: dziala wszedzie,
 * gdzie jest node. Tutaj potrzebny jest prawdziwy DOM - readRow() wola
 * cloneNode(), classList i getAttribute(), a watchImporter() stoi na
 * MutationObserver. Zaslepka tego nie udaje sensownie: test parsera DOM na
 * atrapie DOM sprawdza atrape.
 *
 * Wiec jsdom jest zalezoscia OPCJONALNA, dokladnie jak Handlebars w check.sh:
 * gdy go nie ma, ten plik konczy sie zielono i mowi, ze pominal. W CI jest
 * instalowany, wiec tam testy naprawde chodza.
 *
 *   npm install --no-save handlebars jsdom && node tests/markup.mjs
 *
 * CZEGO TE TESTY NIE ZROBIA
 * -------------------------
 * Fixture jest odtworzony z opisu w naglowku importer-watch.mjs, nie zgrany
 * z zywego okna. Wykryja wiec regresje w NASZYM kodzie, a nie zmiane markupu
 * po stronie 5etools. Instrukcja podmiany na prawdziwy zrzut jest w naglowku
 * tests/fixtures/plutonium-import-classes.html i to jest ta czynnosc, ktora
 * naprawde warto powtorzyc po aktualizacji Plutonium.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  // Na maszynie bez jsdom pominiecie jest w porzadku - to zwykly klon repo.
  // W CI nie jest: tam jsdom jest instalowany, wiec jego brak znaczy, ze
  // instalacja padla i CI wlasnie sprawdza mniej, nie wiedzac o tym. Zielony
  // przebieg, ktory po cichu przestal cokolwiek testowac, jest gorszy od
  // czerwonego, bo nikt go nie oglada.
  if (process.env.PK5E_TESTS_REQUIRE_DEPS) {
    console.log("  FAIL brak jsdom, a PK5E_TESTS_REQUIRE_DEPS jest ustawione");
    console.log("       instalacja zaleznosci nie powiodla sie - testy markupu nie zostaly wykonane");
    process.exit(1);
  }

  // "SKIP" jest tu po to, zeby check.sh odroznil pominiecie od zaliczenia.
  // Pominiety test, ktory czyta sie jak zielony, jest gorszy od jego braku.
  console.log("SKIP brak jsdom - testy markupu pominiete (npm install --no-save handlebars jsdom)");
  process.exit(0);
}

// --- DOM z fixture, plus tyle Foundry, ile potrzebuje modul ------------------

const html = readFileSync(join(here, "fixtures", "plutonium-import-classes.html"), "utf8");
const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

// warnMarkup() pyta o game.user.isGM, trace() o ustawienia. Jako GM zobaczymy
// ostrzezenia, ktore sa czescia tego, co testujemy.
globalThis.game = { user: { isGM: true }, settings: { get: () => false } };

const { readRow, watchImporter, importerRect } = await import("../scripts/importer-watch.mjs");

// --- harness, ten sam co w run.mjs ------------------------------------------

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}\n       oczekiwano ${b}\n       otrzymano  ${a}`);
    console.log(`  FAIL ${name}`);
  }
}

function group(title, body) {
  console.log(`\n${title}`);
  return body();
}

const row = (kase) => document.querySelector(`[data-case="${kase}"]`);

// --- czytanie pojedynczego wiersza ------------------------------------------

group("importer: czytanie wiersza listy", () => {
  check("klasa: nazwa, typ, kod zrodla z klasy CSS", readRow(row("class-artificer")), {
    name: "Artificer",
    type: "class",
    parentName: "Artificer",
    code: "EFA"
  });

  // Etykieta obok mowi "PHB'24", kod w klasie CSS mowi XPHB. Liczy sie kod:
  // to jego uzywa kompendium do rozstrzygania remisow.
  check("klasa: kod bierze sie z klasy CSS, nie z tresci etykiety", readRow(row("class-cleric")).code, "XPHB");

  check("podklasa: myslnik odciety, rodzic z atrybutu title", readRow(row("subclass-light")), {
    name: "Light Domain",
    type: "subclass",
    parentName: "Cleric",
    code: "XPHB"
  });

  // Ten przypadek zlamal juz dopasowywanie w compendium.mjs: jedna nazwa
  // zawiera druga. Tutaj pilnujemy tylko, ze czytanie ich nie skleja.
  check("podklasa, ktorej nazwa zawiera nazwe innej", readRow(row("subclass-twilight")), {
    name: "Twilight Domain",
    type: "subclass",
    parentName: "Cleric",
    code: "TCE"
  });

  check("brak komorki zrodla to pusty kod, nie blad", readRow(row("subclass-no-source")).code, "");

  check("wiersz bez komorki nazwy to null", readRow(row("not-a-row")), null);
  check("null nie wywraca readRow", readRow(null), null);
  check("obiekt bez querySelector nie wywraca readRow", readRow({}), null);
});

// --- rozpoznanie okna --------------------------------------------------------

group("importer: rozpoznanie okna", () => {
  const rect = importerRect();
  check("okno importera zostalo znalezione po tytule", rect !== null, true);

  // Ekran wyboru zrodel i wybor narzedzia dziela klase ve-app z importerem.
  // Rozroznia je wylacznie tytul, wiec to on jest tu sprawdzany.
  const other = document.createElement("div");
  other.className = "ve-app";
  other.innerHTML = '<h1 class="window-title">Select Sources</h1>';
  document.body.appendChild(other);
  check("inne okno ve-app nie udaje importera", importerRect() !== null, true);
  document.querySelector('[data-fixture="plutonium-import-classes"]').remove();
  check("po usunieciu importera zostaje samo Select Sources i nie jest brane", importerRect(), null);
});

// --- obserwowanie zaznaczen --------------------------------------------------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// SETTLE_MS wynosi 60; czekamy z zapasem, ale nie tyle, zeby test byl wolny.
const SETTLED = 150;

await group("importer: co trafia do panelu po kliknieciu", async () => {
  // Fixture zostal wyzej usuniety - odbudowujemy czysty dokument.
  dom.window.document.body.innerHTML = html;

  const seen = [];
  const stop = watchImporter({ onSelect: (r) => seen.push(r), onClose: () => seen.push("closed") });

  const select = (kase) => row(kase).classList.add("list-multi-selected");

  select("class-cleric");
  await wait(SETTLED);
  check("klikniecie klasy podaje ta klase", seen.at(-1)?.name, "Cleric");

  // Klikniecie podklasy podswietla przy okazji jej klase. Obie mutacje moga
  // trafic w jedna partie - i wtedy wygrac ma podklasa, bo to ona byla
  // klinieciem, a klasa jego skutkiem ubocznym.
  //
  // KOLEJNOSC W PARTII JEST TU CALYM TESTEM. Gdy podklasa jest ostatnia,
  // "ostatnia podklasa" i "ostatni wiersz" daja te sama odpowiedz i test
  // przechodzi takze dla kodu, ktory bierze po prostu ostatni wiersz. Dopiero
  // klasa NA KONCU partii rozroznia jedno od drugiego - a tego, ktora bedzie
  // ostatnia, nie kontrolujemy, wiec liczy sie wlasnie ten przypadek.
  seen.length = 0;
  select("subclass-twilight");
  select("class-artificer");
  await wait(SETTLED);
  check(
    "podklasa wygrywa, nawet gdy klasa przyszla po niej",
    seen.map((r) => r.name),
    ["Twilight Domain"]
  );

  // I ten sam uklad w druga strone, zeby nie zalezalo od kolejnosci wcale.
  seen.length = 0;
  for (const el of document.querySelectorAll(".veapp__list label")) {
    el.classList.remove("list-multi-selected");
  }
  await wait(SETTLED);
  seen.length = 0;
  select("class-cleric");
  select("subclass-light");
  await wait(SETTLED);
  check(
    "podklasa wygrywa takze, gdy przyszla po klasie",
    seen.map((r) => r.name),
    ["Light Domain"]
  );

  // Odznaczenie nie czysci panelu: czytajacy prawdopodobnie wciaz czyta.
  seen.length = 0;
  row("subclass-twilight").classList.remove("list-multi-selected");
  await wait(SETTLED);
  check("odznaczenie niczego nie zglasza", seen, []);

  // Filtrowanie przemalowuje cala liste naraz. To nie jest wybor gracza.
  seen.length = 0;
  for (const el of document.querySelectorAll(".veapp__list label")) {
    el.classList.remove("list-multi-selected");
  }
  await wait(20);
  for (let i = 0; i < 12; i += 1) {
    const el = document.createElement("label");
    el.innerHTML = '<span class="ve-col-9 ve-bold">Bulk</span>';
    document.querySelector(".veapp__list").appendChild(el);
    el.classList.add("list-multi-selected");
  }
  await wait(SETTLED);
  check("hurtowe przemalowanie listy nie jest wyborem", seen, []);

  stop();

  // Po zatrzymaniu obserwator ma milczec - inaczej panel zyje dluzej niz okno,
  // ktore obsluguje.
  seen.length = 0;
  select("subclass-light");
  await wait(SETTLED);
  check("po stop() nic wiecej nie przychodzi", seen, []);
});

// --- zgrywanie fixture i samokontrola ----------------------------------------
//
// selfTest() i captureImporter() sa narzedziami do zywego swiata i wiekszosci
// z nich tutaj nie sprawdzimy. Ale logika przycinania listy jest zwyklym kodem,
// a jej awaria jest podstepna: produkuje fixture, ktory WYGLADA dobrze i nie
// zawiera podklas, czyli polowy tego, co czytamy.

await group("captureImporter: przycinanie listy do probki", async () => {
  dom.window.document.body.innerHTML = html;

  // Tyle Foundry, ile wola selftest.mjs po drodze.
  globalThis.game = {
    user: { isGM: true },
    settings: { get: () => false },
    system: { id: "dnd5e", version: "5.3.3" },
    version: "14",
    modules: { get: () => null }
  };
  // selftest.mjs siega po tidy.mjs, a ten przez guide.mjs po cala reszte okien,
  // wiec potrzebny jest pelny zestaw zaslepek ApplicationV2 - nie sama mapa
  // instancji.
  globalThis.foundry = {
    applications: {
      api: {
        ApplicationV2: class {},
        HandlebarsApplicationMixin: (Base) => class extends Base {},
        DialogV2: { confirm: async () => false }
      },
      instances: new Map(),
      ux: { TextEditor: { implementation: { enrichHTML: async (h) => h } } }
    }
  };
  globalThis.ui = { windows: {}, notifications: { warn: () => {} } };
  globalThis.CONFIG = { Actor: { sheetClasses: { character: {} } }, DND5E: {} };

  // Schowek w jsdom nie istnieje; captureImporter ma sobie z tym poradzic
  // i mimo wszystko zwrocic markup, bo to on jest celem, nie schowek.
  // Node ma wlasne globalThis.navigator wylacznie z getterem, wiec podmiana
  // przez przypisanie konczy sie TypeError. defineProperty dziala i na nowym
  // node, i na starym, gdzie navigator moze w ogole nie istniec.
  let clipboard = null;
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (t) => { clipboard = t; } } },
    configurable: true,
    writable: true
  });

  const { captureImporter, selfTest } = await import("../scripts/selftest.mjs");

  const quiet = { log: console.log, group: console.group, groupEnd: console.groupEnd,
    table: console.table, info: console.info, warn: console.warn };
  const silence = () => { for (const k of Object.keys(quiet)) console[k] = () => {}; };
  const restore = () => { for (const [k, fn] of Object.entries(quiet)) console[k] = fn; };

  // Lista ustawiona wrogo: najpierw wszystkie klasy, potem wszystkie podklasy,
  // i probka na tyle waska (rows: 2), zeby naiwne "wez pierwsze N" nie moglo
  // przypadkiem zlapac podklasy.
  // Bez tego pierwsze cztery wiersze fixture'a to przypadkiem dwie klasy i dwie
  // podklasy, wiec naiwne "wez pierwsze N" tez by przeszlo - i test sprawdzalby
  // zbieg okolicznosci zamiast gwarancji, ktora ma dawac probkowanie.
  const listEl = document.querySelector(".veapp__list");
  const isSub = (el) => {
    const cell = el.querySelector?.(".ve-col-9");
    return cell && !cell.classList.contains("ve-bold");
  };
  for (const el of Array.from(listEl.children).filter(isSub)) listEl.appendChild(el);

  silence();
  const markup = await captureImporter({ rows: 2 });
  restore();

  const parse = (s) => new JSDOM(`<!doctype html><body>${s}</body>`).window.document;
  const cut = parse(markup);
  const kept = Array.from(cut.querySelectorAll(".veapp__list label"));
  const bold = kept.filter((el) => el.querySelector(".ve-col-9.ve-bold")).length;
  const plain = kept.filter((el) => {
    const cell = el.querySelector(".ve-col-9");
    return cell && !cell.classList.contains("ve-bold");
  }).length;

  check("probka nie jest cala lista", kept.length < 6, true);

  // To jest ten test, dla ktorego ta grupa istnieje. Fixture zlozony z samych
  // klas przechodzilby wszystkie pozostale testy tego pliku i nie sprawdzalby
  // ani odciecia myslnika, ani czytania rodzica z title.
  check("probka zawiera oba rodzaje wiersza", { klasy: bold > 0, podklasy: plain > 0 }, {
    klasy: true,
    podklasy: true
  });

  check("markup wrocil do schowka", clipboard === markup, true);
  check("zrzut zaczyna sie od okna importera, nie od listy", markup.startsWith("<div"), true);

  // Przyciety zrzut musi zostac zrozumialy dla tego, kto go potem znajdzie
  // w repozytorium i nie bedzie pamietal, skad ma tylko cztery wiersze.
  check("przyciecie zostawia po sobie notatke", /przyciete: \d+ wierszy/.test(markup), true);

  silence();
  const full = await captureImporter({ full: true });
  restore();
  const all = parse(full).querySelectorAll(".veapp__list label").length;
  check("full: true nie przycina", all, document.querySelectorAll(".veapp__list label").length);

  // selfTest ma dzialac takze wtedy, gdy prawie nic nie jest otwarte - i mowic
  // "pominieto", a nie udawac, ze sprawdzil.
  silence();
  const checksOut = selfTest();
  restore();
  const byStatus = (s) => checksOut.filter((c) => c.status === s).length;
  check("selfTest cos zwraca", checksOut.length > 0, true);
  check("bez otwartej karty selfTest raportuje pominiecia", byStatus("pominieto") > 0, true);
  check(
    "otwarte okno importera jest rozpoznane, nie pominiete",
    checksOut.find((c) => c.name === "okno importera klas")?.status,
    "ok"
  );
});

// --- wynik -------------------------------------------------------------------

console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`\n  ${passed} przeszlo, ${failures.length} nie`);
  process.exit(1);
}
console.log(`  ${passed} przeszlo, 0 nie`);
