# Prosty Kreator Postaci (D&D 5e)

Prowadzony krok po kroku kreator postaci dla Foundry VTT i systemu **dnd5e**.

Moduł **niczego nie reimplementuje**. Każdy krok klika prawdziwy przycisk karty
postaci — „Dodaj gatunek", „Dodaj pochodzenie", „Dodaj klasę" — więc system
Advancement i importer działają dokładnie tak, jak zostały zbudowane. Kreator
dokłada trzy rzeczy, których brakuje: **kolejność**, **to, o co importer nigdy
nie pyta** (punktacja cech, języki) i **wykrywanie tego, co zostało pominięte**.

Wersja **2.0.0**.

---

## Instalacja

W Foundry: *Konfiguracja* → *Dodatki* → *Moduły* → *Zainstaluj moduł* → w polu
*Adres manifestu* wklej:

```
https://github.com/samchopamsa/prosty-kreator-5e/releases/latest/download/module.json
```

Ten adres zawsze wskazuje najnowsze wydanie, więc Foundry sam zaproponuje
aktualizację. Żeby zostać na starszej wersji, wklej adres konkretnego tagu:
`.../releases/download/v2.0.0/module.json`.

### Wymagania

| | wersja | uwagi |
|---|---|---|
| **Foundry VTT** | 13 lub nowszy | sprawdzone na 14 |
| **system dnd5e** | 5.0.0 lub nowszy | sprawdzone na 5.3.3; świat musi być na tym systemie |

Innych zależności nie ma. Moduł nie ma kroku budowania, nie ma `node_modules`,
nie pobiera niczego w trakcie działania i nie używa socketu — to zwykłe moduły
ES ładowane wprost przez Foundry.

### Zewnętrzny importer klas

**Zalecany, nie wymagany, ale bez niego kreator robi znacznie mniej.** Kroki
klasy, gatunku i pochodzenia prowadzą przez importer, jeśli jest zainstalowany;
z niego pochodzą też biblioteki reguł, na których stoją opisy klas obok listy
i porównanie postaci z regułami.

Bez importera: te trzy kroki korzystają z systemowej przeglądarki kompendiów, a
opisy klas i porównanie z regułami są niedostępne. Reszta — kolejność, punktacja
cech, języki, portret, raport braków, spis tego, co krok dołożył — działa
normalnie.

### Zgodność z innymi modułami

Panel jest osobnym oknem ApplicationV2 i nie podmienia karty postaci, więc
moduły zmieniające wygląd interfejsu zwykle mu nie przeszkadzają.

| moduł | stan | uwagi |
|---|---|---|
| **Tidy 5e Sheets** | obsługiwany | przycisk kreatora rejestruje się przez API Tidy (`registerCharacterHeaderControls`), a nie przez wstrzykiwanie do jego markupu — element wstrzyknięty w Svelte znika po cichu |
| **Carolingian UI** | działa | sprawdzone; panel dziedziczy motyw okna, a nie narzuca własnego tła |
| moduły zmieniające **kartę postaci** | ostrożnie | kreator klika przyciski „Dodaj klasę" i awansu **na karcie**; karta, która je przenosi albo przemianowuje, może je ukryć przed modułem. Diagnoza: `characterCreator.selfTest()` |
| moduły zmieniające **okna importera** | ostrożnie | panel z opisami klas przykleja się do okna importera po jego tytule i układzie listy |

Zawodzenie jest **ciche z założenia**: jeśli któryś selektor przestanie pasować,
dana funkcja po prostu nic nie robi, a tworzenie postaci idzie dalej. Ceną jest
awaria wyglądająca jak „jakoś nic się nie dzieje" — od tego jest `selfTest()`
opisany niżej.

---

## Jak to wygląda

Panel to dwie kolumny. Po lewej **szyna kroków**: każdy krok z numerem, nazwą i
jednolinijkową odpowiedzią — jaka klasa, jakie pochodzenie, ile języków. Cała
postać czyta się w dół lewej strony, bez otwierania czegokolwiek. Po prawej
**karta wyłącznie aktywnego kroku**.

1. **Start** — imię i portret
2. **Klasa** — z opisami do przeczytania obok listy importera
3. **Gatunek**
4. **Pochodzenie**
5. **Punktacja cech** — wybierana na karcie: standardowa tablica, zakup punktów,
   rzuty albo ręcznie, z sumą liczoną na bieżąco
6. **Języki** — też na karcie: tabela 1d12, rzut, wyszukiwarka, lista
7. **Bio** — opis, charakter, historia; zapisywane wprost na kartę
8. **Podsumowanie** — wszystko, co panel potrafi sprawdzić, i przycisk
   „Finalizuj"

Każda uwaga z podsumowania pokazuje się **także przy kroku, który ją naprawia** —
i dopiero wtedy, gdy krok jest zrobiony, a jego import się skończył.

Zrobiony krok pokazuje pod spodem **spis tego, co naprawdę wylądowało na
karcie**: biegłości, języki, cechy, zaklęcia, ekwipunek, punkty życia, monety.
Nie z przewidywania reguł, tylko z odczytu karty przed krokiem i po nim — więc
homebrew też się liczy. Najechanie na pozycję pokazuje ten sam opis co karta
postaci.

Panel czyta kartę i pokazuje, co już na niej wylądowało. Nie próbuje wykrywać,
kiedy zamykasz cudze okno — te okna stoją nad panelem, zamykasz je i wracasz.

---

## Co to daje ponad sam importer

### Punktacja cech, o którą nikt nie pyta

Importer buduje niemal gotową kartę — klasę, gatunek, pochodzenie, cechy,
ekwipunek, punkty życia — ale **nigdy nie pyta o punktację cech**. Postać kończy
z dziesiątkami wszędzie i nikt tego nie zauważa aż do pierwszego rzutu.

Uwaga na pułapkę, którą moduł obsługuje: premia z pochodzenia jest wpisywana
**wprost w `system.abilities.X.value`**, a nie trzymana osobno. Nadpisanie
punktacji zniszczyłoby ją po cichu. Dlatego moduł czyta premie z advancementów
postaci i pokazuje działanie, zanim cokolwiek zapisze.

### Jeden poziom na raz

Ekran wyboru poziomu pozwala zaznaczyć kilka poziomów naraz — a wtedy importer
przepuszcza je hurtem i **pomija dialogi**, które by o wybory zapytały,
najwidoczniej podklasę. Postać kończy bez decyzji, o które nikogo nie zapytano.
Kreator zaznacza najniższy dostępny poziom i zatwierdza; kolejne poziomy dodaje
się przyciskiem awansu, każdy ze swoimi oknami.

### Opisy klas obok importera

Importer wypisuje same nazwy. Wąski panel przyklejony do jego okna pokazuje, co
dana klasa albo podklasa faktycznie robi — klikasz nazwę w importerze, czytasz
obok. Działa też przy awansie i wieloklasowości.

### Trzy niezależne sposoby wykrywania braków

Są ślepe w różnych miejscach i **żaden nie zastępuje pozostałych**:

- **czytanie karty** — zero punktów życia, zerowa szybkość, nieprzypisane
  premie do cech, puste wpisy Trait, wymagania wieloklasowości
- **czytanie reguł** — porównanie postaci z tym, co klasa faktycznie daje na
  danym poziomie (wymaga importera)
- **obserwowanie okien** — wybory, których dialogi importera **nie zapisują
  nigdzie**: styl walki, sztuczki. Pominięty wybór nie zostawia w danych żadnego
  śladu; jedyny moment, w którym ta informacja istnieje, to czas wyświetlania
  okna

### Awans poziomu, który mówi co się zmieniło

Foundry jest tu dziwnie milczące: klikasz przez kilka okien i lądujesz na
karcie różniącej się w sposób, którego nikt nie wypisuje. Moduł robi odczyt
przed i po, i pokazuje różnicę.

### Portret bez menedżera plików

Zamiast przeglądarki plików Foundry — źródło, drzewo katalogów, pole ścieżki —
dwa pytania: obrazek z dysku albo odnośnik. Wgrany plik trafia do jednego
folderu ustalonego przez MG, a portret ląduje na karcie **i** na prototypie
żetonu.

---

## Ustawienia

Najważniejsze (pełna lista w *Konfiguracja modułu*):

| ustawienie | domyślnie | uwagi |
|---|---|---|
| Język panelu | `en` | gracz może nadpisać dla siebie; ustawienia i treści z kompendiów zostają po angielsku |
| Jak rozpoznawane są istniejące premie do cech | z advancementów | najodporniejsze — czyta deklaracje z przedmiotów postaci, ignoruje to, co jest na karcie |
| Jak działa awansowanie | doświadczenie | dolewa PD do następnego poziomu, zanim naciśnie przycisk. Bez tego dnd5e potrafi odmówić awansu **po cichu**, co wygląda jak zawieszony wieloklas |
| Bierz po jednym poziomie | włączone | patrz „Jeden poziom na raz" wyżej |
| Klikanie przez ekrany startowe importera | dla graczy | ekran pyta, które podręczniki czytać — MG ma na to zdanie, gracz nie ma jak odpowiedzieć. **Lepiej ustawić w samym importerze** *Use Importer when Using ADD… Button* na *Always* |
| Gdzie trafiają wgrane portrety | `assets/portrety` | tworzone w razie potrzeby; gracz nigdy nie widzi ścieżki |
| Opisy klas obok importera | włączone | |
| Panel opisów wewnątrz okna importera | włączone | wyłącz na małym ekranie, gdzie dwie kolumny zwężają listę |
| Ukryj przycisk awansu importera | wyłączone | tylko stylowanie — przycisk zostaje na karcie, moduł nadal go naciska |
| Gracze mogą zakładać postacie | wyłączone | wymaga też uprawnienia `ACTOR_CREATE` |

Jeśli gracze mają sami wgrywać portrety, potrzebują uprawnienia
`FILES_UPLOAD` (*Konfiguracja* → *Uprawnienia*). Bez niego ekran portretu
pokazuje im tylko pole na odnośnik.

---

## Konsola

Dostępne jako `characterCreator` (oraz `game.modules.get("prosty-kreator-5e").api`):

```js
characterCreator.guide()                    // nowa postać
characterCreator.resume(actorId)            // wróć do zaczętej
characterCreator.complete(actorId)          // punktacja cech na gotowej karcie
characterCreator.levelUp(actorId)

characterCreator.debug(actorId)             // wszystko, co moduł sądzi o postaci
characterCreator.debugCompendiums()
characterCreator.stamps(actorId)            // czy przedmioty niosą stemple importera
characterCreator.rules("Fighter", 3)        // co reguły przewidują
characterCreator.verify(actor, "Fighter", 3)// postać kontra reguły
characterCreator.tidy()                     // czy Tidy jest wykryte
characterCreator.setDebug(true)             // logowanie na bieżąco

characterCreator.selfTest()                 // czy zaczepienia w cudzym markupie trzymają
characterCreator.captureImporter()          // zgranie okna importera na fixture testowy
characterCreator.captureDialog()            // opis otwartego okna importera
```

`debug()` bez argumentu bierze zaznaczony żeton albo Twoją postać.

`selfTest()` warto uruchomić po aktualizacji systemu dnd5e albo importera, a
także po dołożeniu modułu zmieniającego kartę postaci. Moduł sięga do markupu,
którego nie jest właścicielem, i robi to tak, żeby zawodzić cicho — zepsuty
selektor zostawia tworzenie postaci w spokoju, zamiast wywracać je błędem. Ceną
jest awaria wyglądająca jak „jakoś nic się nie dzieje", a to polecenie zamienia
ją w listę. Wynik ma trzy stany, nie dwa: `ok`, `NIE ZNALEZIONO` i `pominięto` —
to ostatnie znaczy, że odpowiednie okno było zamknięte i **nic nie zostało
sprawdzone**. Otwórz kartę postaci i okno importera, żeby zobaczyć pełny obraz.

---

## Dwie linie wersji

| linia | gałąź | układ |
|---|---|---|
| **2.x** | `main` | szyna kroków po lewej, jedna karta na ekranie — to, co opisuje ten plik |
| **1.x** | `v1` | wszystkie kroki na jednym, przewijanym ekranie |

Obie budują postać tak samo i zapisują te same dane, więc postać zrobiona w
jednej otwiera się w drugiej bez migracji. Linia 1.x jest utrzymywana, ale nowe
rzeczy trafiają najpierw do 2.x.

---

## Rozwój

Bez zależności i bez kroku budowania — `scripts/*.mjs` to moduły ES ładowane
wprost przez Foundry.

```bash
./check.sh                   # składnia, szablony, tłumaczenia, cykle importów,
                             # zgodność wersji, testy - wszystko przed wypchnięciem
node tests/run.mjs           # testy jednostkowe (globalne Foundry zaślepione)
node tests/steps-smoke.mjs
node tests/markup.mjs        # testy cudzego markupu (wymaga jsdom)
```

Ten sam `check.sh` chodzi w CI przy każdym push i pull requeście.

Wydanie: podbij `version` w `module.json`, dopisz sekcję w `CHANGELOG.md`,
popraw pole `download` na nowy tag (`check.sh` przypilnuje wszystkich trzech),
a potem:

```bash
git tag v2.0.0 && git push origin main v2.0.0
```

Paczkę, opis wydania z changeloga i sam release tworzy workflow.

Wskazówki dla pracujących nad kodem — w [CLAUDE.md](CLAUDE.md); tam też
wskazane notatki techniczne z katalogu `docs/`.

---

## Historia zmian

[CHANGELOG.md](CHANGELOG.md)
