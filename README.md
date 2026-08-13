# Character Creator (D&D 5e) — 1.20.0

Prowadzone tworzenie postaci dla Foundry VTT, które **korzysta z narzędzi, które
już masz**, zamiast je zastępować.

- Foundry: **v13 lub v14**
- System: **dnd5e 5.0+** (rozwijane na 5.3)
- Współpracuje z: Plutonium, DDB Importer, systemowy Compendium Browser

---

## Idea

Moduł nie implementuje własnego wyboru gatunku, klasy, ekwipunku ani zaklęć.
Każdy krok klika **ten sam przycisk, który jest na karcie postaci**, więc
uruchamia się dokładnie to, co masz zainstalowane. Dokładamy trzy rzeczy, których
importery nie robią: **kolejność**, **kontekst dla gracza** i **atrybuty**.

---

## Narzędzia

### Panel tworzenia — 7 kroków

Przycisk **New Character** w zakładce Aktorzy, przycisk na karcie postaci, albo
prawy przycisk na aktorze → *Start / resume creation*.

1. **Imię** — zapisuje się od razu, także Enterem
2. **Gatunek** — otwiera systemowy przycisk *Add Species*
3. **Pochodzenie** — jw.
4. **Klasa** — jw., plus okno referencyjne do czytania o klasach
5. **Atrybuty** — zestaw standardowy, zakup punktowy, rzut 4k6 lub ręcznie
6. **Języki** — tabela 1d12 z podręcznika, rzut lub wybór z listy
7. **Portret** — opcjonalny, nie wlicza się do postępu

Panel obserwuje kartę i odhacza kroki sam. Okna Plutonium pojawiają się na
wierzchu — zamykasz je i wracasz. Każdy krok ma zwijane **„What is this?"** z
wyjaśnieniem dla kogoś, kto nie zna zasad.

Na dole **raport gotowości**: braki blokujące (gatunek, pochodzenie, klasa, HP,
szybkość, atrybuty) oddzielone od wartych sprawdzenia (języki, biegłości,
ekwipunek, portret). Przycisk **Finalize** odblokowuje się dopiero po
skończeniu wszystkiego poza portretem.

### Complete Character

Przypisuje atrybuty i języki **istniejącej** postaci — tej zbudowanej importerem,
który nigdy o nie pyta. Rozpoznaje premie już naliczone na karcie i pokazuje
wynik przed zapisem. Zapamiętuje przypisaną bazę, więc **ponowne uruchomienie nie
nalicza premii drugi raz**.

### Okno referencyjne

Lista klas i podklas z kompendiów, z pełnym opisem po kliknięciu — bo importer
pokazuje same nazwy. Drzewko odwzorowuje foldery i **scala je po nazwie** w
poprzek kompendiów: „Barbarian" z dwóch podręczników to jedna gałąź.

---

## Dla Mistrza Gry

W panelu, na górze, sekcja **Ownership and filing**: przypisanie gracza i folder.
Wybór gracza nazywa też postać „New Character for <gracz>", dopóki nikt nie nadał
jej własnej nazwy.

Typowy przepływ: tworzysz postać, przypisujesz gracza, zamykasz. Gracz otwiera
kartę i panel wita go sam.

**Uprawnienia:** gracz tworzący postać samodzielnie potrzebuje *Create New
Actors* (Ustawienia → Konfiguruj Uprawnienia). Bez tego przycisk się nie pokaże.
Można też w ogóle nie nadawać tego uprawnienia i tworzyć postacie za graczy.

---

## Ustawienia

| Ustawienie | Domyślnie |
|---|---|
| Teksty panelu (7 pól: wstęp + kroki) | puste = tekst wbudowany |
| Show 'What is this?' explanations | włączone |
| Click through the import dialogs automatically (gracze) | wyłączone |
| Click through the import dialogs automatically (GM) | wyłączone |
| Skip the data source screen (gracze) | wyłączone |
| Skip the data source screen (GM) | wyłączone |
| Untick 'Keep Window Open' while clicking through | włączone |
| Show 'New Character' in the Actors sidebar | włączone |
| Show buttons on the character sheet | włączone |
| Open the panel automatically for players | włączone |
| Also show 'Complete Character' in the sidebar | wyłączone |
| Narrow tooltips in the Compendium Browser | włączone |
| Reference: compendiums to read | wszystkie |
| Reference: GM sees every compendium | włączone |
| Folder for new characters | brak |
| Players may start a new character | włączone |

Panel otwiera się graczowi **raz**; zamknięcie zapisuje to na postaci i więcej
sam nie wraca.

---

## Ustawienia po stronie Plutonium

Żeby gracze widzieli węższy zakres niż Ty, w Config Editorze:

- **Apply World Content Blocklist for GMs** → wyłącz (gracze zostają ograniczeni)
- **Enable Data Source Filtering for Players** → włącz
- **Enable Data Source Filtering for GMs** → zostaw wyłączone

Same blokowane źródła ustawiasz w **World Content Blocklist** (ikona teczki w
katalogach), a listę plików danych w **World Data Source Selector**.

Uwaga: **Automatically Update Blocklist from Rules Version** potrafi po cichu
usuwać z blocklisty wpisy źródeł 2024. Wyłącz, jeśli chcesz mieć pewność, że
lista zostaje taka, jak ją ustawiłeś.

---

## Wejścia awaryjne

```js
characterCreator.guide()            // nowa postać
characterCreator.resume(actorId)    // powrót do przerwanej
characterCreator.complete(actorId)  // atrybuty
characterCreator.languages(actorId) // języki
characterCreator.reference()        // okno referencyjne
```

---

## Skrypty pomocnicze

Poza modułem, do jednorazowego użycia w makrze lub konsoli:

- **struktura-folderow-klas.js** — tworzy w kompendium foldery klas z podfolderem
  *Subclasses*
- **porzadkowanie-kompendium.js** — rozkłada płasko zaimportowane klasy i podklasy
  do folderów, dopasowując po `system.classIdentifier`

Oba są bezpieczne do wielokrotnego uruchomienia i niczego nie usuwają.

---

## Ograniczenia

- Zakłada **poziom 1**. Awanse prowadzi karta postaci i Plutonium.
- Okno referencyjne czyta **kompendia**. Plutonium pobiera dane w locie i nie da
  się go odpytać, więc listy zgadzają się tylko na tyle, na ile zgadzają się
  włączone podręczniki.
- Wykrywanie końca importu opiera się na tytułach okien Plutonium. Krok bywa
  odhaczony chwilę przed faktycznym zakończeniem — kosmetyka, dane nie giną.
- Automatyczne klikanie i zawężanie dymków ingerują w interfejs innych paczek.
  Oba mają wyłączniki; po aktualizacji Plutonium mogą przestać działać, nic
  poza tym się nie stanie.

---

## Gdy coś nie działa

**F12 → Console**, powtórz czynność, skopiuj czerwony błąd. Przydaje się wersja
Foundry i dnd5e (*Ustawienia → Wsparcie i Zgłaszanie Błędów*).

Po aktualizacji: `git pull`, potem **Ctrl+Shift+R**. Numer wersji na liście
modułów odświeża się dopiero po restarcie serwera — sam kod ładuje się przy
odświeżeniu strony. Sprawdzenie stanu:

```
git pull && grep '"version"' module.json && ls scripts/ | wc -l
```
