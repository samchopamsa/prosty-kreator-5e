# Prosty Kreator Postaci (D&D 5e) — wersja 0.1

Kreator postaci dla Foundry VTT, który czyta dane **z Twoich kompendiów** — nie ma
w kodzie żadnej zaszytej listy gatunków czy klas.

- Foundry: **v13 lub v14**
- System: **dnd5e 5.0+** (testowane pod kątem 5.3.x)

---

## Instalacja (5 minut, bez programowania)

1. Znajdź folder danych Foundry (w launcherze: **Configuration → User Data Path**).
   Zwykle jest to `.../FoundryVTT/Data/`.
2. Wejdź do podfolderu `modules`.
3. Skopiuj tam cały folder `prosty-kreator-5e` (ten, w którym leży ten plik).
   Ścieżka końcowa musi wyglądać tak:
   `.../Data/modules/prosty-kreator-5e/module.json`
4. Uruchom ponownie Foundry (albo cały serwer).
5. Wejdź do świata → **Ustawienia → Zarządzaj Modułami** → zaznacz
   **Prosty Kreator Postaci** → Zapisz.

Przycisk **„Kreator Postaci"** pojawi się na dole zakładki **Aktorzy**.
Można go też odpalić makrem: `prostyKreator.open()`

---

## Pierwsze uruchomienie — wybór źródeł

W kroku **Start** rozwiń sekcję *Źródła danych*. Zobaczysz listę wszystkich
kompendiów z przedmiotami. Domyślnie włączone są kompendia systemowe (SRD).

Kiedy zaimportujesz coś Plutonium, import trafia do **kompendiów świata** —
pojawią się na tej samej liście jako „Świat" i wystarczy je zaznaczyć.
Nie trzeba zmieniać ani linijki kodu.

Wybór zapisuje się na poziomie świata, więc ustawia go **Mistrz Gry** raz.
Gracze widzą listę tylko do wglądu.

---

## Jak to działa (i dlaczego akurat tak)

Kreator świadomie **nie** implementuje wyboru ekwipunku ani zaklęć od zera.
System dnd5e ma własny mechanizm *Advancement*, który to robi — i robi to
zgodnie z aktualnymi zasadami, także po aktualizacjach systemu.

Podział pracy wygląda tak:

| Robi kreator | Robi system dnd5e (Advancement) |
|---|---|
| imię postaci | punkty życia |
| wybór gatunku / pochodzenia / klasy z kompendiów | biegłości i języki |
| atrybuty bazowe (zestaw / punkty / rzut / ręcznie) | podniesienie atrybutów z pochodzenia (+2/+1) |
| stworzenie aktora we właściwej kolejności | atut startowy |
| | ekwipunek startowy |
| | zaklęcia i sztuczki |

Kolejność dodawania to gatunek → pochodzenie → klasa. To celowe: pochodzenie
podnosi atrybuty, więc kiedy przychodzi rzut na punkty życia, modyfikator
Kondycji jest już poprawny.

---

## Uprawnienia dla graczy

Żeby gracz mógł sam stworzyć postać, potrzebuje uprawnienia
**Tworzenie nowych Aktorów**:
*Ustawienia → Konfiguruj Uprawnienia → Create New Actors → zaznacz rolę Gracz*.

Bez tego kreator wyświetli błąd na samym końcu. Alternatywa: MG uruchamia
kreator przy graczu.

W ustawieniach modułu można też całkiem wyłączyć przycisk dla graczy.

---

## Zmiana tekstów dla nowych graczy

Wszystkie komunikaty widoczne w oknie są w jednym pliku:
`templates/creator.hbs`

Możesz je przepisać pod swoją kampanię (otwórz w Notatniku albo VS Code, zmień
tekst między znacznikami HTML, zapisz, odśwież Foundry klawiszem F5).
Kod tego nie ruszy. Podpowiedzi na dole okna siedzą w `scripts/creator.mjs`
w funkcji `stepHint`.

---

## Znane ograniczenia wersji 0.1

- Tylko poziom 1. Podklasa (poziom 3) i awanse — poza zakresem.
- Wielo­klasowość nieobsługiwana.
- Brak osobnego kroku „ekwipunek dodatkowy" — jest tylko to, co daje system.
- Nie filtruje duplikatów, jeśli to samo pochodzenie jest w dwóch kompendiach.
  Etykieta kompendium jest widoczna pod każdą pozycją, więc widać, co jest z czego.

---

## Co robić, gdy coś nie działa

Otwórz konsolę przeglądarki (**F12** → zakładka *Console*), powtórz czynność,
która się wysypała, i skopiuj czerwony komunikat błędu wraz z kilkoma liniami
pod nim. To wystarczy, żeby namierzyć problem.

Przydaje się też: wersja Foundry i wersja systemu dnd5e
(*Ustawienia → Wsparcie i Zgłaszanie Błędów*).
