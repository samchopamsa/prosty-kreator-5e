/**
 * tests/markup.mjs
 * ---------------------------------------------------------------------------
 * Testy tego, co czyta CUDZY markup - dzis okna importera klas.
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
 * NA CZYM STOJA
 * -------------
 * Fixture jest ZGRANY Z ZYWEGO OKNA (2026-08-25), a nie odtworzony z opisu -
 * wczesniejsza wersja byla odtworzona i wlasnie dlatego nie wykrywala niczego,
 * czego ten opis nie mowil. Podmiana na prawdziwy zrzut od razu pokazala trzy
 * rozbieznosci; szczegoly w naglowku samego fixture.
 *
 * Przypadki brzegowe, ktorych w zrzucie nie bylo - wiersz bez zrodla, wiersz
 * nie bedacy wierszem listy, dwie nazwy zawierajace sie nawzajem - buduje
 * syntheticRow() w tym pliku. Zrzut zostaje nietkniety, zeby dalej mowil, jak
 * wyglada rzeczywistosc, a nie jak ja sobie wyobrazamy.
 *
 * Odswiezenie po aktualizacji importera: characterCreator.captureImporter()
 * i wklejenie schowka do fixture, ponizej jego komentarza naglowkowego.
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

const html = readFileSync(join(here, "fixtures", "importer-class-list.html"), "utf8");
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

// Fixture jest teraz ZGRANY Z ZYWEGO OKNA, wiec nie ma w nim zadnych atrybutow
// dolozonych na potrzeby testow - wiersze znajdujemy tak, jak znalazlby je
// czlowiek: po nazwie w komorce nazwy.
const allRows = () => Array.from(document.querySelectorAll(".veapp__list label"));

const row = (name) =>
  allRows().find((el) => {
    const cell = el.querySelector(".ve-col-9");
    if (!cell) return false;
    const clone = cell.cloneNode(true);
    clone.querySelectorAll(".ve-mx-3").forEach((e) => e.remove());
    return clone.textContent.trim() === name;
  });

/**
 * Wiersz zbudowany na potrzeby przypadku, ktorego w zrzucie nie bylo.
 *
 * Podzial jest celowy: fixture zostaje nietkniety i mowi, jak wyglada
 * rzeczywistosc, a przypadki brzegowe - wiersz bez zrodla, wiersz ktory nie
 * jest wierszem listy, dwie nazwy zawierajace sie nawzajem - powstaja tutaj.
 * Doklejanie ich do zrzutu zamienialoby dowod w nasza wlasna wyobraznie.
 */
const syntheticRow = ({ name, bold = false, parent = null, source = null }) => {
  const label = document.createElement("label");
  label.className = "ve-flex ve-w-100 veapp__list-row-hoverable";
  const cell = document.createElement("span");
  cell.className = bold ? "ve-col-9 ve-bold" : "ve-col-9";
  if (parent) {
    cell.setAttribute("title", `Class: ${parent}`);
    const dash = document.createElement("span");
    dash.className = "ve-mx-3";
    dash.textContent = "—";
    cell.appendChild(dash);
  }
  cell.appendChild(document.createTextNode(name));
  label.appendChild(cell);
  if (source) {
    const src = document.createElement("span");
    src.className = `ve-col-2 ve-text-center ve-source__${source}`;
    src.textContent = source;
    label.appendChild(src);
  }
  document.querySelector(".veapp__list").appendChild(label);
  return label;
};

// --- czytanie pojedynczego wiersza ------------------------------------------

group("importer: czytanie wiersza listy", () => {
  check("klasa: nazwa, typ, kod zrodla z klasy CSS", readRow(row("Artificer")), {
    name: "Artificer",
    type: "class",
    parentName: "Artificer",
    code: "EFA"
  });

  // W zrzucie etykieta tego wiersza brzmi doslownie "PHB'24", a klasa CSS mowi
  // ve-source__XPHB. Liczy sie kod - i dopiero na prawdziwym markupie ten test
  // naprawde cos znaczy.
  check("klasa: kod bierze sie z klasy CSS, nie z tresci etykiety", readRow(row("Cleric")).code, "XPHB");

  check("podklasa: myslnik odciety, rodzic z atrybutu title", readRow(row("Alchemist")), {
    name: "Alchemist",
    type: "subclass",
    parentName: "Artificer",
    code: "EFA"
  });

  // Podklasa z innego podrecznika niz jej klasa - przypadek, ktorego nie bylo
  // w moim odtworzonym fixture, bo nie przyszedl mi do glowy. W prawdziwym
  // oknie znalazl sie sam.
  check("podklasa moze miec inne zrodlo niz jej klasa", readRow(row("Reanimator")), {
    name: "Reanimator",
    type: "subclass",
    parentName: "Artificer",
    code: "RHW"
  });

  // Ten przypadek zlamal juz dopasowywanie w compendium.mjs: jedna nazwa
  // zawiera druga. Tutaj pilnujemy tylko, ze czytanie ich nie skleja.
  syntheticRow({ name: "Light Domain", parent: "Cleric", source: "XPHB" });
  const twilight = syntheticRow({ name: "Twilight Domain", parent: "Cleric", source: "TCE" });
  check("podklasa, ktorej nazwa zawiera nazwe innej", readRow(twilight), {
    name: "Twilight Domain",
    type: "subclass",
    parentName: "Cleric",
    code: "TCE"
  });

  const bezZrodla = syntheticRow({ name: "Homebrew Domain", parent: "Cleric" });
  check("brak komorki zrodla to pusty kod, nie blad", readRow(bezZrodla).code, "");

  const nieWiersz = document.createElement("label");
  nieWiersz.innerHTML = '<div class="ve-col-12">Nothing here looks like a name cell.</div>';
  check("wiersz bez komorki nazwy to null", readRow(nieWiersz), null);
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
  // Panel opisow tez nosi klase "application", ale nie "ve-app" - to okno
  // importera znika, nasz panel zostaje.
  document.querySelector(".ve-app").remove();
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

  select("Cleric");
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
  select("Alchemist");
  select("Artificer");
  await wait(SETTLED);
  check(
    "podklasa wygrywa, nawet gdy klasa przyszla po niej",
    seen.map((r) => r.name),
    ["Alchemist"]
  );

  // I ten sam uklad w druga strone, zeby nie zalezalo od kolejnosci wcale.
  seen.length = 0;
  for (const el of document.querySelectorAll(".veapp__list label")) {
    el.classList.remove("list-multi-selected");
  }
  await wait(SETTLED);
  seen.length = 0;
  select("Cleric");
  select("Barbarian");
  select("Armorer");
  await wait(SETTLED);
  check(
    "podklasa wygrywa takze, gdy przyszla po klasie",
    seen.map((r) => r.name),
    ["Armorer"]
  );

  // Odznaczenie nie czysci panelu: czytajacy prawdopodobnie wciaz czyta.
  seen.length = 0;
  row("Alchemist").classList.remove("list-multi-selected");
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
  select("Battle Smith");
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

  // captureDialog() wolalo titleOf(), ktorego w pliku nie bylo. node --check
  // tego nie widzi, bo to blad dopiero w czasie wykonania - a jedynym miejscem,
  // gdzie by wybuchl, byla konsola w Foundry. Wystarczy WYWOLAC funkcje, zeby
  // taka dziura nie przeszla drugi raz.
  const { captureDialog } = await import("../scripts/selftest.mjs");
  const dialog = document.createElement("div");
  dialog.className = "ve-app";
  dialog.innerHTML =
    '<h1 class="window-title">Choose Option: Fighting Style (Level 1)</h1>' +
    '<div>Wybierz styl walki. <select><option>-</option></select></div>' +
    '<button class="ve-btn ve-btn-primary">OK</button><button class="ve-btn">Skip</button>';
  // offsetParent jest w jsdom zawsze null, wiec filtr "widoczne" odcialby
  // wszystko. Podmieniamy go na czas testu.
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent", {
    get() { return this.parentNode; },
    configurable: true
  });
  document.body.appendChild(dialog);

  silence();
  const dialogs = await captureDialog();
  restore();

  const found = dialogs.find((d) => d.title.startsWith("Choose Option"));
  check("captureDialog czyta tytul okna", !!found, true);
  check("captureDialog znajduje przycisk potwierdzenia", found?.przyciski.find((b) => b.primary)?.tekst, "OK");
  check("captureDialog liczy listy na mysliku", found?.listNaMysliku, 1);

  // To jest ta odpowiedz, dla ktorej narzedzie powstalo: czy obserwator
  // pominietych wyborow w ogole widzi to okno.
  check("captureDialog mowi, ze DIALOGS rozpoznaje znane okno", found?.rozpoznane, "choice");

  const obcy = document.createElement("div");
  obcy.className = "ve-app";
  obcy.innerHTML = '<h1 class="window-title">Starting Equipment</h1><button class="ve-btn">OK</button>';
  document.body.appendChild(obcy);
  silence();
  const withUnknown = await captureDialog();
  restore();
  check(
    "nierozpoznane okno jest nazwane wprost, nie przemilczane",
    /NIE - to okno jest dla nas niewidzialne/.test(
      withUnknown.find((d) => d.title === "Starting Equipment")?.rozpoznane ?? ""
    ),
    true
  );
  obcy.remove();
  dialog.remove();
  const byStatus = (s) => checksOut.filter((c) => c.status === s).length;
  check("selfTest cos zwraca", checksOut.length > 0, true);
  check("bez otwartej karty selfTest raportuje pominiecia", byStatus("pominieto") > 0, true);
  check(
    "otwarte okno importera jest rozpoznane, nie pominiete",
    checksOut.find((c) => c.name === "okno importera klas")?.status,
    "ok"
  );
});

// --- ekran wyboru poziomu ----------------------------------------------------
//
// Markup zbudowany z KODU importera (Charactermancer_Class_LevelSelect), nie z
// wyobrazenia o nim: wiersz to <label class="veapp__list-row"> z inputem, ktory
// nosi ve-no-events, numer poziomu w osobnym span, stopka z <button
// class="ve-btn ve-btn-primary">OK</button>.
//
// Wiersze dostaja tu taka sama obsluge kliku, jaka ma importer: preventDefault()
// i przelaczenie inputu recznie. To istotne, bo preventDefault na <label>
// KASUJE natywne przelaczenie inputu - bez tego test sprawdzalby zachowanie
// jsdom, a nie zachowanie importera.

// group() zwraca to, co cialo - wiec cialo asynchroniczne trzeba tu doczekac.
// Bez tego wynik drukuje sie przed testami i ich porazka nie wywraca przebiegu.
await group("importer: ekran wyboru poziomu", async () => {
  const { isLevelScreen, answerLevelScreen } = await import("../scripts/level-select.mjs");

  const buildScreen = ({ title = "Select Class Levels", levels = 5, muted = 0,
                         disabled = 0, ticked = [], type = "checkbox" } = {}) => {
    const app = document.createElement("div");
    app.className = "ve-app";
    app.innerHTML = `<h1 class="window-title">${title}</h1><div class="veapp__list"></div>
      <div><button class="ve-btn ve-btn-primary ve-mr-2">OK</button>
           <button class="ve-btn ve-btn-default">Cancel</button></div>`;
    const list = app.querySelector(".veapp__list");

    for (let ix = 0; ix < levels; ix++) {
      const row = document.createElement("label");
      row.className = `ve-w-100 ve-flex veapp__list-row${ix < muted ? " ve-muted" : ""}`;
      row.innerHTML = `<span class="ve-col-1"><input type="${type}" class="ve-no-events"></span>
        <span class="ve-col-1-5 ve-text-center">${ix + 1}</span><span class="ve-col-9-5">Features</span>`;
      const input = row.querySelector("input");
      if (ix < disabled) input.disabled = true;
      if (ticked.includes(ix)) input.checked = true;
      row.addEventListener("click", (evt) => {
        evt.preventDefault();
        if (input.disabled) return;
        input.checked = !input.checked;
      });
      list.append(row);
    }
    document.body.append(app);
    return app;
  };

  const tickedIndexes = (app) =>
    Array.from(app.querySelectorAll(".veapp__list-row"))
      .map((row, ix) => (row.querySelector("input").checked ? ix : -1))
      .filter((ix) => ix >= 0);

  check("okno rozpoznane po tytule", isLevelScreen(buildScreen()), true);
  check(
    "wersja z podklasa tez",
    isLevelScreen(buildScreen({ title: "Select Class and Subclass Levels" })),
    true
  );
  check("inne okno importera nie", isLevelScreen(buildScreen({ title: "Select Cantrips" })), false);

  // Nowa klasa: nic nie zaznaczone, ma wejsc dokladnie poziom 1.
  const fresh = buildScreen();
  check("swieza klasa zostaje odpowiedziana", answerLevelScreen(fresh), true);
  check("i to jednym poziomem", tickedIndexes(fresh), [0]);

  // Level up: poziomy juz posiadane sa wyszarzone, wiec "nastepny" to pierwszy
  // niewyszarzony, a nie pierwszy w liscie.
  const levelling = buildScreen({ muted: 3 });
  answerLevelScreen(levelling);
  check("przy level upie wchodzi pierwszy dostepny poziom", tickedIndexes(levelling), [3]);

  // Tryb radio: poziomy ponizej sa disabled, nie wyszarzone.
  const radio = buildScreen({ type: "radio", disabled: 2 });
  answerLevelScreen(radio);
  check("disabled liczy sie tak samo jak wyszarzony", tickedIndexes(radio), [2]);

  // Gdyby importer zdazyl zaznaczyc wiecej, nadmiar schodzi.
  const many = buildScreen({ ticked: [0, 1, 2] });
  answerLevelScreen(many);
  check("nadmiarowe poziomy sa odklikiwane", tickedIndexes(many), [0]);

  // Markup, ktorego nie rozpoznajemy, zostaje nietkniety - to jest cudze okno.
  const noRows = buildScreen({ levels: 0 });
  check("okno bez wierszy nie jest zatwierdzane", answerLevelScreen(noRows), false);

  const noOk = buildScreen();
  noOk.querySelector("button.ve-btn-primary").remove();
  check("brak przycisku OK to rezygnacja", answerLevelScreen(noOk), false);
  check("ale zaznaczenie juz zostaje", tickedIndexes(noOk), [0]);

  document.querySelectorAll(".ve-app").forEach((app) => app.remove());
});

// --- wynik -------------------------------------------------------------------

console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`\n  ${passed} przeszlo, ${failures.length} nie`);
  process.exit(1);
}
console.log(`  ${passed} przeszlo, 0 nie`);
