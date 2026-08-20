# Historia zmian

Format: jedna sekcja na wersję, najnowsza u góry. Numer wersji zgadza się
z `module.json` i z tagiem gita (`v1.51.0`), więc do każdej da się wrócić:

```
git checkout v1.50.1     # podejrzenie starej wersji
git checkout main        # powrót do bieżącej
```

Wersjonowanie semantyczne: **1.X.0** — nowa funkcja, **1.0.X** — poprawka.

---

## 1.56.2

- Usunieta ramka "Przegladaj kompendium klas" z kroku Klasa. Panel czyta teraz
  wprost z danych 5etools, wiec kompendium przestalo byc droga do opisow -
  a odsylanie do niego bylo odsylaniem do gorszego zrodla.
- Razem z nia poszly: nieuzywana juz akcja `openReference`, trzy klucze
  tlumaczen i dwie reguly stylow bez wlasciciela.
- Okno `ClassReference` zostaje dostepne przez `characterCreator.reference()`.

## 1.56.1

- **Brew i prerelease dociagane razem z danymi podstawowymi.** `loadJSON()`
  zwraca tylko oficjalne dane, wiec Path of the Titan z NWB czy inne pozycje
  z listy zrodel Plutonium nie mialy opisu - czyli akurat te, ktorych gracz
  najpewniej nie zna. Doszly `loadBrew()` i `loadPrerelease()`, kazde osobno
  zabezpieczone, wiec brak jednego nie psuje reszty.
- Panel ladowal pod lista mimo `!important`. Plutonium tez uzywa `!important`,
  a przy remisie decyduje waga selektora - podbita.
- Panel otwiera sie razem z oknem importera, niezaleznie od tego, jak zostalo
  otwarte. Dotad wolal go tylko krok "Klasa" w kreatorze, wiec dojscie do
  importera inna droga - druga klasa, przycisk na karcie, ponowne otwarcie po
  anulowaniu - dawalo liste bez opisow i bez sladu, ze opisy istnieja.

## 1.56.0

Opisy klas czytane wprost z danych 5etools, nie z kompendiow.

- `scripts/class-text.mjs` - pelny tekst klasy albo podklasy: opis z pliku
  fluffu, tabela poziomow z `classTableGroups` i cechy wszystkich dwudziestu
  poziomow z opisami. Gracz widzi nie tylko to, co dostaje teraz, ale i co
  przyjdzie pozniej.
- **Dziala dla wszystkich 352 pozycji, ktore wypisuje importer.** Kompendia
  trzymaja to, co zostalo do tego swiata zaimportowane, a importer oferuje
  wszystko ze wszystkich podrecznikow - Path of the Battlerager z SCAG czy
  College of Spirits z RHW dawaly dotad "nie ma w kompendiach", czyli akurat
  te pozycje, ktorych gracz najpewniej nie zna.
- Zrodlo jest jawne takze przy fluffie. Pliki fluffu zawieraja obie edycje, a
  zapytanie o "Barbarian" bez podania ksiazki zwraca tekst z 2014 - to nie
  brak opisu, tylko opis nieprawdziwy, trudniejszy do zauwazenia i gorszy
  w skutkach.
- Kompendia zostaja jako zapas, gdy Plutonium nie jest zaladowane.
- Obrazy pominiete: ich sciezki sa wewnetrzne dla 5etools, bez adresu
  bazowego, wiec to, na co sie rozwina, zalezy od konfiguracji.

## 1.55.2

- Panel czeka na swoje okno, zamiast wisiec obok. Plutonium otwiera najpierw
  okno wyboru zrodel danych, a liste klas dopiero po nim - panel byl proszony
  o otwarcie, zanim bylo gdzie go wstawic, i pokazywal sie jako osobne okno
  obok okna, z ktorym nie ma nic wspolnego. Teraz jest ukryty do czasu, az
  gospodarz sie pojawi. Ukryty, nie zamkniety, wiec wraca juz sledzac liste.
- Lista wezsza (40%), opis szerszy (60%), wymuszana szerokosc okna zmniejszona
  z 54 do 46 rem. Lista to nazwy i skrot zrodla, wiec szerokosc lepiej wydac
  na opis.
- Usuniety prog 1100 px, ponizej ktorego panel wracal pod liste. Miala to byc
  pomoc na malym ekranie, a wychodzilo na to, ze panel laduje na dole takze
  tam, gdzie miejsca po prawej jest dosc.

## 1.55.1

Poprawki dokowania, obie z podgladu na zywo.

- Panel ladowal pod lista zamiast obok niej. Rodzic listy ma klase
  `ve-flex-col` od Plutonium, ktora ustawia kolumne z ta sama waga co nasza
  regula - wygrywal arkusz zaladowany pozniej. Kierunek wymuszony.
- Dokowanie bywalo pomijane i panel zostawal osobnym oknem. Obserwator reaguje
  tylko na zmiane, a okno Plutonium czesto jest juz otwarte, gdy panel sie
  renderuje. Dolozone kilka przebiegow w ciagu pierwszego polsekundy.
- Ponizej 1100 px panel wraca pod liste zamiast obok - dwie kolumny zostawialy
  liste nieczytelna.
- Zadokowany panel ukrywa wlasne pole wyszukiwania i rozwijana liste: dubluja
  liste, ktora jest tuz obok.

## 1.55.0

Panel opisow wchodzi do srodka okna Plutonium, zamiast obok niego wisiec.

- `scripts/dock.mjs` - przenosi element panelu do okna "Import Classes &
  Subclasses", po prawej stronie listy. Panel dziala dokladnie jak dotad:
  sledzi podswietlony wiersz i czyta opisy z kompendiow. Zmienia sie wylacznie
  to, gdzie jego element siedzi na stronie.
- Wlasny pasek tytulu, uchwyt przeciagania i rog zmiany rozmiaru sa ukryte -
  w cudzym oknie nic nie znacza.
- Przy zamknieciu okna Plutonium albo panelu element wraca na strone, zeby nie
  zostal zniszczony razem z gospodarzem.
- Ustawienie "Put the description panel inside the importer", per uzytkownik,
  domyslnie wlaczone. Wylaczenie przywraca ruchome okno - przydatne na malym
  ekranie, gdzie dwie kolumny zostawiaja za waska liste.

**Odrzucone po drodze.** Wersja robocza przemalowywala wszystkie okna
zbudowane jako lista pol wyboru. Wycofane: gracz spotkalby trzy okna
poprawione i cztery nietkniete, wiec niespojnosc, ktora miala zniknac,
byloby wieksza.

Druga wersja robocza budowala wlasny panel opisow od zera - duplikat tego, co
`importer-panel.mjs` robi od dawna. Rowniez wycofana.

## 1.54.0

Porownanie z regulami trafia do interfejsu - pierwsza rzecz z tego watku,
ktora widzi gracz, a nie tylko konsola.

- `scripts/checkup.mjs` - porownanie w ksztalcie, ktorym mowi lista kontrolna
  panelu tworzenia. Zawsze ostrzezenia, nigdy bledy: brak cechy warto
  powiedziec, ale to nie powod, zeby nie pozwolic skonczyc postaci.
- Panel tworzenia dopisuje wyniki do istniejacej listy kontrolnej. Gracz czyta
  jedna liste, nie dwie, i nie musi wiedziec, skad co pochodzi.
- Okno awansu pokazuje uwagi po kazdym zdobytym poziomie, obok podsumowania
  zmian z migawek. Migawka mowi co przyszlo, porownanie - czego brakuje.
- Linia "cechy zgadzaja sie z regulami" przy braku uwag. Bez niej ciche
  przejscie jest nie do odroznienia od tego, ze sprawdzenie sie nie odbylo.

**Podsluch okien Plutonium zostaje.** Obie metody sa slepe gdzie indziej:
porownanie widzi tylko to, co zostawia przedmiot na karcie (nie ASI, nie wybor
zaklec, nie jezyki), a podsluch dziala tylko przy otwartym panelu. Zamiana
jednego na drugie oznaczalaby utrate zasiegu.

## 1.53.1

Poprawki liczenia wyborow, obie wykryte na postaciach wzorcowych.

- Wybory liczone po konwencji nazewniczej Plutonium ("Nazwa: Opcja"), a nie po
  liscie opcji z danych. Manewr `Brace` pochodzi z TCE i nie ma go na liscie
  `Maneuver Options` z XPHB, przez co kompletny wybor pokazywal sie jako 2 z 3.
- `Divine Order` wybor trafia na karte z `page: "classFeature"`, nie jako
  `optionalfeature` - liczenie obejmuje teraz obie przestrzenie nazw.
- Cecha zawierajaca wybor nie jest juz zglaszana jako brakujaca; mowi o niej
  linia z licznikiem. `Divine Order` istnieje na karcie i dopasowuje sie po
  hashu, `Maneuver Options` nie istnieje nigdy - obie sytuacje daja teraz
  jedna czytelna linie.

## 1.53.0

Sprawdzanie calej postaci zamiast pojedynczego poziomu. Wszystkie zmiany
wynikaja z porownania na postaciach wzorcowych.

- `characterCreator.verify(id)` bez poziomu sprawdza postac od 1. poziomu do
  obecnego, klasa po klasie, wiec dziala takze przy wieloklasowosci.
- **Wybory sa liczone, nie szukane.** `Maneuver Options` to nie przedmiot,
  tylko dwadziescia manewrow z poleceniem wybrania trzech. Zamiast zglaszac
  brak, modul pisze teraz "3 z 3". Rozpoznanie po bloku `type: "options"`
  w danych i po `page: "optionalfeatures.html"` na karcie.
- **Pozycje bez odpowiednika sa pomijane.** `Ability Score Improvement` nigdy
  nie tworzy przedmiotu - zostaje po nim zmieniona wartosc cechy albo atut
  o innej nazwie. Kazdy Wojownik na 4. poziomie dostawal przez to falszywe
  ostrzezenie.
- **Odmowa zamiast zgadywania.** Porownanie postaci, ktora nie ma danej klasy,
  konczy sie komunikatem, a nie lista "brakuje wszystkiego".
- **Ostrzezenie przy zdublowanych nazwach.** `verify("New Character")` przy
  szesciu postaciach o tej nazwie wypisze ich identyfikatory zamiast po cichu
  wziac pierwsza z brzegu.

Filtra na listy zaklec nie ma - sprawdzenie na Kleryku pokazalo, ze
`Light Domain Spells` trafia na karte jako zwykla cecha i dopasowuje sie
poprawnie.

## 1.52.0

Dopasowanie regul do karty postaci kluczem, a nie nazwa.

- `featureHash()` buduje ten sam identyfikator, ktorym Plutonium stempluje
  importowane cechy (`flags.plutonium.hash`). Format odczytany z zywej postaci:
  `nazwa_klasa_zrodloKlasy_poziom_zrodlo`, a dla podklas dodatkowo
  `krotkaNazwaPodklasy_zrodloPodklasy` przed poziomem. Testy sa przypiete do
  dwoch prawdziwych hashy.
- `missingFeatures()` porownuje najpierw po hashu, potem po nazwie, i mowi
  ktora droga poszlo dopasowanie. Nazwa jest potrzebna, bo postac zbudowana
  czesciowo z kompendium systemowego ma cechy bez flagi Plutonium.
- `verifyLevel()` i `characterCreator.verify(postac, klasa, poziom)` -
  porownanie prawdziwej karty z regulami. Tylko raport, nic nie zmienia.
- `docs/plutonium-internals.md` - notatki z lektury kodu Plutonium.

## 1.51.0

Wersjonowanie releasów. Bez zmian w działaniu modułu.

- `.github/workflows/release.yml` — wypchnięcie tagu `v*` buduje release
  z `module.json` i `module.zip`. Przed publikacją uruchamia `./check.sh`
  i sprawdza, czy tag zgadza się z wersją w `module.json`.
- `module.json` — pola `manifest` i `download`, dzięki którym Foundry potrafi
  zainstalować i zaktualizować moduł z adresu, a także zainstalować dowolną
  starszą wersję.
- Ten plik.

## 1.50.1

- `subclassFeaturesAtLevel` czytała podklasy jak klasy i zwracała nie to, co
  trzeba. Struktura jest inna: poziom podklasy trzyma opakowanie, a właściwe
  cechy leżą w jego `entries`. Dla 3. poziomu Battle Mastera zwracała „Battle
  Master" zamiast `Combat Superiority`, `Student of War`, `Maneuver Options`,
  a dla 7. poziomu pustą nazwę, bo tamto opakowanie nie ma pola `name`.
  Teraz schodzi do najgłębszej nazwanej cechy z `__prop: "subclassFeature"`.
- Lista manewrów (`optionalfeature`) nie trafia już na listę zysków — to menu
  do wyboru, a nie coś, co poziom daje.

## 1.50.0

- `scripts/fivetools.mjs` — odczyt reguł wprost z danych 5etools, które
  Plutonium ładuje do strony. `gainsForLevel(klasa, poziom)` mówi, co dany
  poziom powinien dać: cechy, kość życia, ekwipunek startowy. Odczyt, bez
  zmieniania czegokolwiek na karcie.
- Źródło jest zawsze jawne (`XPHB` przed `EFA`, `TCE`, `PHB`), bo dane
  zawierają obie edycje naraz, a blokada źródeł w świecie tu nie działa.
- `characterCreator.rules("Fighter", 1)` w konsoli do sprawdzenia odczytu.

## 1.49.2

- Ukrywanie przycisku awansu Plutonium przez `setProperty` z `important`,
  wywoływane przy każdym renderowaniu.
- Przycisk na karcie celuje w `div.sheet-header-buttons`.

## 1.49.0 i wcześniejsze

Historia sprzed wprowadzenia tego pliku jest w commitach. Najważniejsze:
panel opisów przy importerze, wykrywanie pominiętych wyborów dwiema drogami,
okno awansu z porównaniem migawek, wersjonowanie flag, `check.sh` i testy,
podział `guide.mjs` na `steps.mjs` i `sheet-actions.mjs`.
