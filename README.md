# Prosty Kreator Postaci (D&D 5e)

Moduł do Foundry VTT, który prowadzi gracza przez tworzenie postaci krok po kroku —
**nie zastępując przy tym niczego, co już masz zainstalowane**. Każdy krok naciska ten sam
przycisk, który jest na karcie postaci, więc Plutonium, Compendium Browser i systemowy
mechanizm Advancement działają dokładnie tak jak zwykle.

- Wersja modułu: **1.35.0**
- Foundry: **v13 lub v14** (weryfikowane pod v14)
- System: **dnd5e 5.0+** (rozwijane i testowane na 5.3.x)

---

## Spis treści

- [Filozofia — co moduł robi, a czego nie](#filozofia--co-moduł-robi-a-czego-nie)
- [Instalacja](#instalacja)
- [Jak to wygląda dla gracza](#jak-to-wygląda-dla-gracza)
- [Siedem kroków panelu](#siedem-kroków-panelu)
- [Panel opisów przy importerze](#panel-opisów-przy-importerze)
- [Okno referencji klas i podklas](#okno-referencji-klas-i-podklas)
- [Kontrola gotowości postaci](#kontrola-gotowości-postaci)
- [Języki interfejsu](#języki-interfejsu)
- [Ustawienia](#ustawienia)
- [Uprawnienia dla graczy](#uprawnienia-dla-graczy)
- [API i makra](#api-i-makra)
- [Co moduł zapisuje na aktorze](#co-moduł-zapisuje-na-aktorze)
- [Struktura plików](#struktura-plików)
- [Znane ograniczenia](#znane-ograniczenia)
- [Gdy coś nie działa](#gdy-coś-nie-działa)
- [Utrzymanie README](#utrzymanie-readme)

---

## Filozofia — co moduł robi, a czego nie

Kreator **świadomie nie implementuje** wyboru gatunku, klasy, ekwipunku ani zaklęć od zera.
Robi to system dnd5e (Advancement) i importer (Plutonium), i robi to zgodnie z aktualnymi
zasadami — także po ich aktualizacjach. Moduł dokłada dwie rzeczy, których nikt inny nie robi:

| Robi moduł | Robi system dnd5e / importer |
| --- | --- |
| kolejność kroków i pilnowanie, co jeszcze zostało | punkty życia |
| naciskanie właściwych przycisków karty | biegłości |
| **atrybuty bazowe** (jedyna rzecz, którą importery pomijają) | podniesienia atrybutów z pochodzenia |
| **języki** jako osobny, widoczny krok | atut startowy |
| okno referencji klas i podklas do czytania | ekwipunek startowy |
| kontrola gotowości + karta postaci na czat | zaklęcia i sztuczki |
| tłumaczenie ekranów gracza (PL/EN) | wszystko z kompendiów |

Kolejność jest celowa: gatunek → pochodzenie → klasa. Pochodzenie podnosi atrybuty, więc
gdy przychodzi rzut na punkty życia, modyfikator Kondycji jest już poprawny.

Okna importera pojawiają się **na wierzchu** panelu. Gracz je zamyka i wraca do panelu —
moduł nie próbuje wykrywać, kiedy cudze okno się zamknęło, tylko obserwuje, co wylądowało
na karcie.

---

## Instalacja

Repozytorium: `https://github.com/samchopamsa/prosty-kreator-5e`

### Ręcznie (kopiowanie plików)

1. Znajdź folder danych Foundry (launcher: **Configuration → User Data Path**).
2. Wejdź do podfolderu `Data/modules`.
3. Umieść tam folder `prosty-kreator-5e` — ścieżka końcowa musi wyglądać tak:
   `.../Data/modules/prosty-kreator-5e/module.json`
4. Zrestartuj Foundry.
5. W świecie: **Ustawienia → Zarządzaj Modułami** → zaznacz **Prosty Kreator Postaci** → Zapisz.

### Przez git (aktualizacje na serwerze)

```bash
cd ~/foundrydata/Data/modules/prosty-kreator-5e
git pull
```

Po `git pull` wystarczy odświeżyć przeglądarkę (F5). Foundry czyta pliki modułu przy
starcie świata, więc czasem trzeba wrócić do Setup i wejść do świata ponownie.

**Uwaga przy aktualizacji przez przeglądarkę GitHuba:** wgrywanie plików przez interfejs
GitHuba nie usuwa plików skasowanych lokalnie. Po każdej większej zmianie warto sprawdzić:

```bash
grep '"version"' module.json && ls scripts/ | wc -l
```

---

## Jak to wygląda dla gracza

Panel można otworzyć na cztery sposoby:

- **Zakładka Aktorzy → przycisk „New Character"** — tworzy pustą postać i od razu otwiera panel
- **Przycisk na karcie postaci** (obok przycisków odpoczynku) — „Start creation" / „Resume creation"
- **Prawy klik na postaci w drzewie aktorów → „Start / resume creation"** (tylko gdy coś zostało do zrobienia)
- **Automatycznie** — przy pierwszym otwarciu niedokończonej postaci przez gracza (można wyłączyć)

Panel otwiera się jako duże okno na środku ekranu i pamięta pozycję przewijania między
przerysowaniami. Każda postać ma własne okno panelu, więc dwa jednocześnie sobie nie przeszkadzają.

---

## Siedem kroków panelu

| # | Krok | Co się dzieje |
| --- | --- | --- |
| 1 | **Nazwa** | Pole tekstowe. Do tego sekcja „Ownership and filing”: przypisanie gracza i folder. |
| 2 | **Gatunek** | Naciska „Add Species” na karcie. |
| 3 | **Pochodzenie** | Naciska „Add Background”. |
| 4 | **Klasa** | Naciska „Add Class”. Obok przycisk do okna referencji i „Add a level or another class”. |
| 5 | **Atrybuty** | Własne okno: standardowy zestaw / point buy / rzut 4k6 / ręcznie. |
| 6 | **Języki** | Własne okno: tabela Standard Languages, rzut 1k12 albo wybór. |
| 7 | **Portret** | Opcjonalny. Wybór obrazka. |

Każdy krok ma zwijane wyjaśnienie **„What is this?”** napisane dla kogoś, kto nigdy nie
tworzył postaci. Domyślnie zwinięte, żeby lista pozostała czytelna.

### Atrybuty (krok 5)

To jedyna rzecz, której importery nie pytają — po imporcie wszystkie atrybuty stoją na 10.
Okno pokazuje arytmetykę **zanim** cokolwiek zapisze, bo pochodzenie wpisuje swoje +2/+1
prosto w `system.abilities.X.value`, a nie jako osobny bonus — nadpisanie po cichu by to zniszczyło.

Sposób rozpoznawania istniejących bonusów wybiera MG w ustawieniach (`bonusMode`):

- **advancements** (zalecane) — czyta podniesienia zadeklarowane na przedmiotach postaci,
  ignoruje to, co jest na karcie. Czyści też bonusy zostawione przez importer po skasowanym przedmiocie.
- **measured** — porównuje z bazą zapisaną poprzednio
- **none** — wpisuje przypisane liczby dosłownie

Po zapisaniu karta wraca do trybu gry (play mode), żeby gracz nie został na ekranie edycji.

### Języki (krok 6)

Wcześniej ukryte wewnątrz ekranu atrybutów, gdzie gracze tego po prostu nie znajdowali.
Teraz osobny krok. Common jest zawsze zaznaczony i nie da się go odznaczyć; dwa kolejne to
liczba oczekiwana — wzięcie większej liczby jest możliwe, ale wymaga potwierdzenia.

### Usuwanie i podmiana

Przy gatunku, pochodzeniu i klasie są odnośniki **Change** i **Remove**. Usuwanie idzie przez
systemowy `AdvancementManager.forDeletedItem`, więc cofa też biegłości, cechy i punkty życia,
które ten przedmiot dopisał. Zwykłe skasowanie przedmiotu zostawiłoby to wszystko na karcie.

### Poziomy

Przycisk „Add a level or another class” obsługuje awans i wieloklasowość. Zachowanie zależy
od ustawienia `levelUpMode`:

- **milestone** — przycisk awansu jest naciskany od razu
- **xp** — moduł najpierw pyta o docelowy poziom, uzupełnia doświadczenie do progu, dopiero potem awansuje

Ustaw to zgodnie z trybem awansowania w samym systemie.

---

## Panel opisów przy importerze

Wąskie okno, które staje obok importera i pokazuje opis tego, co gracz właśnie
kliknął na liście. Importer podaje same nazwy — panel dopowiada, co one znaczą,
bez otwierania drugiego okna i bez szukania wpisu ręcznie.

- Otwiera się razem z importerem w kroku klasy (ustawienie `openReferenceWithClass`).
- Zamyka się, gdy zamknie się importer albo gdy klasa wyląduje na karcie.
- Na górze pole wyszukiwania, które po kliknięciu rozwija listę: klasy jako pozycje
  wybieralne, podklasy wcięte pod nimi. Pisanie filtruje, nagłówek klasy zostaje
  widoczny nawet wtedy, gdy sam nie pasuje do wpisanego tekstu — lista domen bez
  „Cleric” nad nimi nic nie mówi.
- Ustawia się z boku importera: po lewej, jeśli jest miejsce, inaczej po prawej.

### Jak rozpoznaje, co kliknięto

Odczytuje z wiersza listy nazwę, typ (klasa czy podklasa), kod podręcznika i klasę
macierzystą. Wszystkie cztery są w znacznikach 5etools: nazwa w `span.ve-col-9`
(pogrubiona dla klas), klasa macierzysta w `title="Class: …"`, kod źródła jako
sufiks klasy CSS `ve-source__XPHB`. Zaznaczenie oznaczane jest klasą
`list-multi-selected`.

Kliknięcie podklasy zaznacza w importerze także jej klasę macierzystą, więc panel
zbiera zaznaczenia przez chwilę i **zawsze wybiera podklasę** — klasa jest wtedy
skutkiem ubocznym kliknięcia, nie jego celem.

Dopasowanie do kompendium: **dokładna nazwa w obrębie tej samej klasy macierzystej**.
Kod podręcznika rozstrzyga tylko remisy. Mierzone na 127 wpisach — trafiło wszystkie.

Świadomie **nie ma** normalizacji nazw ani dopasowania po zawieraniu się nazw. Oba
dały zero trafień na prawdziwych danych, a drugie wyprodukowało jedno fałszywe:
„Twilight Domain” dopasowało się do „Light Domain”, bo jedna nazwa zawiera drugą.

**Uwaga:** `system.source.book` w kompendium to etykieta dla człowieka („PHB 2024”,
„TCoE”) i nie zgadza się z kodami importera. Kanoniczny kod siedzi w
`flags.plutonium.source` i to jego porównujemy.

### Gdy nie ma dopasowania

Panel pisze wprost, czego brakuje, i otwiera listę **zawężoną do podklas tej klasy**,
którą wskazał importer. Gdy nie ma nawet samej klasy, pokazuje pełną listę — lista
zawężona do zera byłaby gorsza niż brak zawężenia.

---

## Okno referencji klas i podklas

Importer pokazuje same nazwy — nowy gracz wybiera klasę na ślepo. To okno czyta kompendia
i wyświetla opisy do przeczytania.

- Drzewo odwzorowuje strukturę folderów, **scaloną po nazwie folderu** między kompendiami.
  Folder „Barbarian” w kompendium jednego podręcznika i taki sam w drugim to jedna gałąź —
  gracz widzi jednego Barbarzyńcę ze wszystkimi podklasami, a nie jednego na książkę.
- Otwiera się wyśrodkowane. Wcześniej stawało po lewej, żeby zmieścić się obok importera,
  ale tę rolę przejął panel opisów — to okno otwiera się teraz świadomie, samo.
- Przy ustawieniu `openReferenceWithClass` otwiera się samo, razem z importerem w kroku klasy.
- **Zamyka się samo**, gdy klasa albo podklasa wyląduje na karcie — decyzja zapadła, więc okno
  nie zostaje nad resztą okien importera. Usunięcie klasy przyciskiem „Remove” go nie zamyka:
  to powód, żeby wrócić do czytania. Zamknięcie importera bez wyboru też go zostawia otwartym.
- W panelu jest podlinkowanym tekstem, nie przyciskiem — przycisk pełnej szerokości obok
  „Choose Class” wyglądał jak druga droga do wybrania klasy, czyli dokładnie odwrotnie
  niż jest w rzeczywistości. Opis mówi wprost, że okno jest tylko do czytania.

**Ważne:** okno czyta **kompendia**. Plutonium pobiera swoje dane w locie i nie da się go
odpytać, więc obie listy zgadzają się tylko o tyle, o ile zgadzają się włączone podręczniki.

### Które kompendia są czytane

**Ustawienia → Reference: compendiums to read → Choose compendiums.** Pusty wybór = wszystkie.
Wybór jest po kompendiach, nie po pojedynczych pozycjach — identyfikatory kompendiów przeżywają
ponowny import, identyfikatory pozycji nie.

Osobny przełącznik `referenceGmSeesAll` sprawia, że ograniczenie dotyczy tylko graczy: MG
czyta wszystko, gracze widzą wyselekcjonowany zestaw.

### Porządkowanie kompendiów

W folderze projektu leżą dwa niezależne makra (nie są częścią modułu):

- `porzadkowanie-kompendium.js` — rozkłada płasko zaimportowaną zawartość do folderów
  `Klasa / Subclasses / Podklasa`. Powiązanie czyta z `system.classIdentifier`, nie zgaduje z nazwy.
- `usuwanie-klas-i-porzadkowanie.js` — dodatkowo kasuje z wybranego kompendium pozycje typu
  `class` (przydatne dla kompendiów dodatkowych podręczników, gdzie importer wciąga klasy,
  które już masz w podstawowym), a potem porządkuje resztę.

Oba wklej do makra typu **Script**, ustaw `PACK_ID` i uruchom. Pierwsze niczego nie usuwa,
drugie prosi o potwierdzenie.

---

## Kontrola gotowości postaci

Na dole panelu jest lista kontrolna. Każdy punkt wziął się z rzeczywistej awarii
zaobserwowanej podczas testów.

**Błędy — blokują grę:**

- pominięte wybory przy gatunku, pochodzeniu lub klasie

- brak gatunku, pochodzenia albo klasy na poziomie 1+
- punkty życia równe zeru (zwykle: anulowany advancement klasy)
- szybkość równa zeru (gatunek się nie zaaplikował)
- atrybuty nieprzypisane (wszystkie na 10 / brak flagi)

**Ostrzeżenia — warte sprawdzenia, ale bywają uzasadnione:**

- brak języków
- brak biegłości w umiejętnościach
- pusty ekwipunek (pomijając `Unarmed Strike`, który jest przyznawany zawsze)
- przyznane komórki zaklęć, ale ani jednego zaklęcia na karcie
- brak portretu
- niespełnione wymagania wieloklasowości

Przycisk **„Post to chat”** wystawia kartę postaci na czat (portret, gatunek/pochodzenie/klasa,
HP, AC, szybkość, sześć atrybutów z modyfikatorami) — MG widzi nowe postacie bez otwierania
każdej karty osobno.

Przycisk **„Finalize”** zamyka panel i otwiera gotową kartę. Jest aktywny dopiero, gdy nie ma błędów.

### Pominięte okna wyboru

Najczęstsza usterka zgłaszana przez graczy: importer otwiera okna wyboru
(biegłości, podniesienie atrybutów, rozmiar), gracz je zamyka, i nie ma jak wrócić.

Kreator to wykrywa i pokazuje komunikat **wprost pod tym wpisem, którego dotyczy** —
nie zbiorczo na dole panelu, gdzie ostrzeżenie stało daleko od rzeczy, o której mówi,
a przy dwóch klasach nie było wiadomo, której dotyczy. W nagłówku kroku zamiast ptaszka
pojawia się wykrzyknik, więc problem widać bez przewijania.

Przycisk **„Usuń i dodaj ponownie"** robi obie rzeczy naraz — usuwa przez systemowy
mechanizm cofania rozwoju, a potem od razu otwiera importer.

Podklasa jest pokazywana wewnątrz wpisu swojej klasy, więc jej pominięte wybory
raportowane są tam — usunięcie klasy i tak zabiera podklasę ze sobą.

Sprawdzane są **wszystkie** przedmioty tego rodzaju: gatunek, pochodzenie, klasa
i podklasa. Ta sama reguła, bez listy oczekiwań — pytamy przedmiot, jakie ma wpisy,
i sprawdzamy tylko te, które istnieją. Nazwy rodzajów mają w polskim dwie formy
(`check.kind.*` w mianowniku, `check.kindOf.*` w dopełniaczu), bo „dla pochodzenia"
i „(pochodzenie)" to różne przypadki.

Wykrywanie opiera się na czterech typach wpisów Advancement, w których pustka
naprawdę znaczy „pominięto":

| typ wpisu | pominięte | uzupełnione |
| --- | --- | --- |
| `Size` | `{"size":""}` | `{"size":"med"}` |
| `AbilityScoreImprovement` | `{"type":"asi"}` | `+ assignments` |
| `Trait` | `{"chosen":[]}` | `{"chosen":["skills:his",…]}` |
| `ItemChoice` | brak `added` | `added` z wpisami |

Ta sama zasada rządzi sprawdzaniem zaklęć: pytamy o **przyznane komórki**
(`system.spells.*.max`), a nie o zadeklarowaną progresję klasy. Mistyczny Rycerz
i Arkanista deklarują progresję, nie mając na pierwszym poziomie czego rzucać,
a klasa z dodatku może działać jeszcze inaczej. Komórki to wynik, który system
policzył dla **tej** postaci na **tym** poziomie — gdy ich nie ma, milczymy.

**Wszystkie pozostałe typy są pomijane.** `ScaleValue` jest pusty na **każdej**
postaci — trzyma wartości liczone z poziomu, nie wybory — więc sprawdzanie samej
pustki dawałoby trzy fałszywe alarmy na każdym poprawnym klesze. Zasada: przy
nieznanym typie milczymy. Przeoczone ostrzeżenie to niedogodność, fałszywe niszczy
zaufanie do całej listy kontrolnej.

### Wymagania wieloklasowości

Sprawdzane dopiero wtedy, gdy postać ma **więcej niż jedną klasę** — przy jednej klasie
zasada w ogóle nie obowiązuje. Wymagania czytane są z pola `system.primaryAbility` na
przedmiocie klasy, a nie z tabeli wpisanej w kod, więc pozostaną poprawne, gdy nowy
podręcznik doda klasę.

Pole rozróżnia dwa warianty: Paladyn wymaga 13 w Sile **i** Charyzmie (`all: true`),
Wojownik w Sile **albo** Zręczności (`all: false`).

Klasa bez wypełnionego pola jest pomijana — brak informacji o wymaganiu to nie to samo
co wymaganie zerowe.

---

## Języki interfejsu

Moduł ma **własne** tłumaczenia (`scripts/i18n.mjs`), nie korzysta z plików językowych Foundry.
Powód: pliki Foundry idą za językiem całego interfejsu, a tutaj gracz może przełączyć sam moduł —
co ma znaczenie, gdy grupa trzyma Foundry po angielsku, a gra po polsku.

- Dostępne: **English**, **Polski**
- MG ustawia domyślny (`defaultLanguage`, zakres świata)
- Gracz przełącza dla siebie przyciskiem w stopce panelu (zapisywane lokalnie w przeglądarce)

**Przetłumaczone:** panel tworzenia, okno atrybutów, okno języków.
**Celowo nieprzetłumaczone:** ustawienia modułu, ekrany źródeł kompendiów, komunikaty
diagnostyczne w konsoli oraz cokolwiek pochodzącego z kompendium lub importera — to teren MG
albo cudze dane.

W szablonach tłumaczenie wywołuje się przez `{{pkT "klucz"}}`, w kodzie przez `t("klucz")`.

### Odmiana w etykietach przycisków

Nazwy kroków występują w dwóch zestawach kluczy: `step.*` (mianownik, nagłówek kroku)
i `stepAcc.*` (biernik, wnętrze przycisku). Dzięki temu po polsku jest „Wybierz klasę”,
a nie „Wybierz: Klasa”. W angielskim oba zestawy są identyczne — nie ma czego odmieniać.

Znane ograniczenie: licznik języków ma tylko dwie formy (`guide.languageCountOne`,
`guide.languageCount`), a polski potrzebuje trzech (1 język / 2 języki / 5 języków).
Obecnie druga forma brzmi „Języki: {0}”, co działa dla każdej liczby.

---

## Ustawienia

**Ustawienia → Ustawienia Modułów → Prosty Kreator Postaci**

### Język

| Ustawienie | Zakres | Domyślnie | Opis |
| --- | --- | --- | --- |
| Panel language | świat | English | Domyślny język ekranów gracza |

### Teksty w panelu

Siedem pól tekstowych (`Panel: opening paragraph`, `Panel: species step`, …, `Panel: portrait step`).
Puste = tekst wbudowany. Pozwala przepisać opisy pod własną kampanię bez ruszania kodu.

### Klikanie przez okna importera

| Ustawienie | Zakres | Domyślnie | Opis |
| --- | --- | --- | --- |
| Click through the import dialogs automatically (GM) | świat | Off | Odpowiada za MG na pytanie „Plutonium czy Compendium Browser” |
| Click through the import dialogs automatically (players) | świat | Off | To samo dla graczy |
| Skip the data source screen (players) | świat | Nie | Naciska „Open Importer” z już zaznaczonymi źródłami |
| Skip the data source screen (GM) | świat | Nie | To samo dla MG |
| Untick „Keep Window Open” while clicking through | świat | Tak | Ten checkbox siedzi na pomijanym ekranie — bez tego gracz, który go zaznaczył, nigdy by go już nie odznaczył |

Lepszym rozwiązaniem niż dwa pierwsze ustawienia jest ustawienie w samym Plutonium
**„Use Importer when Using ADD … Button on Actor”** na *Always* — wtedy pytanie w ogóle
nie pada, a moduł te ustawienia sam pomija.

### Zachowanie panelu

| Ustawienie | Zakres | Domyślnie | Opis |
| --- | --- | --- | --- |
| Show class descriptions beside the importer | świat | Tak | Steruje panelem opisów; szerokie okno referencji działa niezależnie |
| How existing ability score increases are recognised | świat | advancements | Patrz [Atrybuty](#atrybuty-krok-5) |
| How levelling works at your table | świat | milestone | Milestone / Experience |
| Show an „importing” notice while the importer works | świat | Nie | Domyślnie wyłączone — wykrywanie cudzych okien albo gaśnie za wcześnie, albo wisi za długo |
| Show „What is this?” explanations | świat | Tak | Wyjaśnienia dla początkujących |

### Referencja

| Ustawienie | Zakres | Domyślnie | Opis |
| --- | --- | --- | --- |
| Reference: compendiums to read | świat | (wszystkie) | Menu wyboru kompendiów, tylko MG |
| Reference: GM sees every compendium | świat | Tak | Ograniczenie dotyczy wtedy tylko graczy |

### Przyciski i dostęp

| Ustawienie | Zakres | Domyślnie | Opis |
| --- | --- | --- | --- |
| Show „New Character” in the Actors sidebar | świat | Tak | |
| Show buttons on the character sheet | świat | Tak | Przycisk w nagłówku karty |
| Open the panel automatically for players | świat | Tak | Raz, przy pierwszym otwarciu niedokończonej postaci |
| Also show „Complete Character” in the sidebar | świat | Nie | Awaryjnie, gdy przyciski na karcie się nie pojawiają |
| Narrow tooltips in the Compendium Browser | klient | Tak | Podgląd tylko przy nazwie/ikonie, żeby dymek nie zasłaniał checkboxa |
| Players may start a new character | świat | Tak | |

### Ustawienia niewidoczne w interfejsie

`language` (klient — wybór gracza), `referencePacks` (świat — lista kompendiów),
`defaultActorFolder` (świat — folder ustawiany z poziomu panelu, bo tam lista folderów
jest zawsze aktualna).

---

## Uprawnienia dla graczy

Żeby gracz mógł sam utworzyć postać, potrzebuje uprawnienia **Create New Actors**:
*Ustawienia → Konfiguruj Uprawnienia → Create New Actors → zaznacz rolę Gracz*.

Bez tego przycisk „New Character” w ogóle się graczowi nie pokazuje — moduł sprawdza
uprawnienie zawczasu, żeby nie oferować czegoś, co skończy się błędem.

Postać tworzona przez gracza od razu należy do niego i ma nazwę wskazującą właściciela,
żeby MG nie patrzył na rząd identycznych wpisów. Trafia też od razu do folderu domyślnego
(jeśli ustawiony) — nic nie leży luzem na górze drzewa.

---

## API i makra

Po starcie świata dostępne jest `characterCreator` (oraz `game.modules.get("prosty-kreator-5e").api`):

```js
characterCreator.guide()            // nowa postać + panel
characterCreator.resume(actorId)    // panel dla istniejącej postaci
characterCreator.complete(actorId)  // samo okno atrybutów
characterCreator.languages(actorId) // samo okno języków
characterCreator.reference()        // szerokie okno referencji
characterCreator.importerPanel()    // wąski panel opisów
```

Dodatkowo `characterCreator.CreationGuide` i `.CompleteCharacter` — klasy, gdyby trzeba było
sięgnąć głębiej.

---

## Co moduł zapisuje na aktorze

Flagi w przestrzeni `prosty-kreator-5e`:

| Flaga | Znaczenie |
| --- | --- |
| `abilities` | Przypisane atrybuty bazowe i metoda. Zapobiega podwójnemu liczeniu bonusów przy ponownym uruchomieniu. |
| `languages` | Krok języków został domknięty. |
| `guideDismissed` | Gracz zamknął panel — automatyczne otwieranie już nie wraca. |

Brak flagi `abilities` lub `languages` oznacza dla modułu „krok niezrobiony” — stąd
`isIncomplete()` i wpis w menu kontekstowym.

---

## Struktura plików

```
prosty-kreator-5e/
├── module.json
├── README.md
├── scripts/
│   ├── constants.mjs        identyfikator modułu, osobno żeby nic nie importowało się nawzajem
│   ├── module.mjs           punkt wejścia: ustawienia, API, przyciski w drzewie aktorów
│   ├── i18n.mjs             tłumaczenia PL/EN ekranów gracza + helper {{pkT}}
│   ├── guide.mjs            panel siedmiu kroków (największy plik)
│   ├── complete.mjs         okno atrybutów
│   ├── languages.mjs        okno języków
│   ├── reference.mjs        okno referencji klas i podklas
│   ├── reference-config.mjs wybór kompendiów dla referencji
│   ├── sheet-button.mjs     przycisk na karcie + automatyczne otwieranie
│   ├── context-menu.mjs     „Start / resume creation” w menu prawego klawisza
│   ├── browser-tweaks.mjs   zawężenie dymków w Compendium Browser
│   ├── summary.mjs          karta postaci na czat
│   ├── validate.mjs         kontrola gotowości
│   └── ui.mjs               pamiętanie pozycji przewijania
├── styles/
│   └── creator.css
└── templates/
    ├── guide.hbs
    ├── complete.hbs
    ├── languages.hbs
    ├── importer-panel.hbs
    ├── reference.hbs
    └── reference-config.hbs
```

### Uwagi implementacyjne warte zapamiętania

- **Foundry v14 zamraża `this.options` po `super()`** — wymiary okna trzeba policzyć
  *przed* wywołaniem `super()` i przekazać w argumencie.
- **`this.state` jest zarezerwowane** w ApplicationV2 — stan panelu musi mieć inną nazwę.
- Szablon części ApplicationV2 musi mieć **dokładnie jeden korzeń HTML**.
- Nazwa klasy karty dnd5e zmieniała się między wersjami, więc `sheet-button.mjs` nasłuchuje
  na kilku nazwach hooka naraz. Sprawdzenie nazwy w swoim świecie:
  `game.actors.contents[0].sheet.constructor.name`
- Pole nadrzędne folderu bywa dokumentem, bywa samym identyfikatorem — zależnie od wersji.
  Bez normalizacji podfoldery o tej samej nazwie zlewają się w jeden.
- `browser-tweaks.mjs` sięga do DOM cudzego pakietu, więc jest celowo defensywny i da się
  go wyłączyć. Gdy system zmieni znaczniki, poprawka po prostu przestaje się aplikować.

---

## Znane ograniczenia

- **Wieloklasowość** — panel ostrzega, gdy wymagania atrybutów nie są spełnione, ale nie
  blokuje: część stołów rezygnuje z tej zasady. Poza tym awanse obsługuje system.
- **Duplikaty** nie są filtrowane. Jeśli to samo pochodzenie siedzi w dwóch kompendiach,
  zobaczysz je dwa razy; etykieta kompendium jest widoczna.
- **Awanse powyżej poziomu 1** są przekazywane systemowi i Plutonium — moduł tylko naciska przycisk.
- Referencja czyta **tylko kompendia**, nie dane pobierane przez Plutonium w locie.
- Panel opisów sięga do znaczników cudzego pakietu. Gdy 5etools je zmieni, panel
  przestanie cokolwiek znajdować — kreator działa dalej bez zmian. **MG dostanie wtedy
  ostrzeżenie w konsoli** (F12) z listą selektorów, których panel szukał; gracz nic nie widzi.
- Panel obsługuje **wyłącznie importer klas**. Gatunki i pochodzenia mają własną
  prezentację w importerze.
- Wykrywanie zakończenia importu jest z założenia niepełne (ustawienie „importing notice”
  domyślnie wyłączone) — panel obserwuje kartę, nie cudze okna.

---

## Gdy coś nie działa

1. **F12 → zakładka Console**, powtórz czynność, skopiuj czerwony komunikat i kilka linii pod nim.
2. Podaj wersję Foundry i systemu dnd5e (*Ustawienia → Wsparcie i Zgłaszanie Błędów*).
3. Sprawdź, czy wgrała się właściwa wersja modułu:

```bash
cd ~/foundrydata/Data/modules/prosty-kreator-5e
grep '"version"' module.json && ls scripts/ | wc -l
```

Typowe przypadki:

| Objaw | Prawdopodobna przyczyna |
| --- | --- |
| Przycisku „New Character” nie ma | Gracz nie ma uprawnienia *Create New Actors*, albo `allowPlayers` jest wyłączone |
| Przycisku na karcie nie ma | Inna nazwa klasy karty — sprawdź `sheet.constructor.name` i użyj `sidebarComplete` jako obejścia |
| Importer otwiera pustą listę | Źródła nie są zaznaczone w Plutonium, a ekran źródeł jest pomijany |
| Atrybuty liczą się podwójnie | Zmień `bonusMode` na *advancements* |
| Punkty życia na zerze | Advancement klasy został anulowany — usuń klasę przez „Remove” i dodaj ponownie |

---

## Utrzymanie README

Ten plik opisuje wersję **1.35.0**. Przy każdej zmianie funkcjonalności aktualizujemy:

1. numer wersji na górze (musi zgadzać się z `module.json`),
2. tabelę ustawień, jeśli doszło lub zniknęło ustawienie,
3. strukturę plików, jeśli doszedł lub zniknął plik,
4. sekcję ograniczeń, jeśli coś przestało być ograniczeniem.
