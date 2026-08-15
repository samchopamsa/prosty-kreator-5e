/**
 * i18n.mjs
 * ---------------------------------------------------------------------------
 * Translations for the screens a PLAYER sees: the creation panel, the ability
 * score window and the language window.
 *
 * Deliberately NOT translated: module settings, the compendium source screens,
 * diagnostic messages in the console, and anything coming out of a compendium
 * or an importer. Those are the GM's territory or someone else's data.
 *
 * This does not use Foundry's own translation files, because those follow the
 * language of the whole interface. Here a player can switch just this module,
 * which matters when the group runs Foundry in English but plays in Polish.
 */

import { MODULE_ID } from "./constants.mjs";

const STRINGS = {
  en: {
    "guide.title": "New Character",
    "guide.windowTitle": "Character Creation Wizard",
    "guide.disclaimerTitle": "Before you start - how this creator works",
    "guide.disclaimerSource": "Species, background and class come from the importer, which is not part of this creator. Its windows open on top of this panel and ask their own questions.",
    "guide.disclaimerComplete": "Work through every one of those windows to the end. Closing one with Skip, Cancel or the X leaves that choice unmade, and the step will be incomplete.",
    "guide.disclaimerWait": "Wait for the importer to finish. It is done when the \"Import Complete\" window appears - close that one, and only then carry on here.",
    "guide.disclaimerRedo": "A finished step cannot be edited afterwards. To change anything you remove it and start that step again.",
    "guide.intro":
      "Seven steps, in order. Some of them hand you over to the importer, which opens as its own separate window on top of this panel - it is not part of the creator, and it may ask several questions of its own. Work through it, close it, and come back here: this panel keeps track of what has already reached the character sheet.",
    "guide.missing": "This character no longer exists.",
    "guide.ownership": "Ownership and filing",
    "guide.player": "Player",
    "guide.playerHint": "Who can open and edit this character.",
    "guide.nobody": "— nobody yet —",
    "guide.folder": "Folder",
    "guide.noFolder": "— none —",
    "guide.setDefaultFolder": "Put new characters here from now on",
    "guide.unsetDefaultFolder": "Stop putting new characters here",
    "guide.defaultFolderIs": "New characters go to \"{0}\".",
    "guide.noDefaultFolder": "New characters are not filed automatically.",

    "step.name": "Name",
    "step.species": "Species",
    "step.background": "Background",
    "step.class": "Class",
    "step.abilities": "Ability scores",
    "step.languages": "Languages",
    "step.portrait": "Portrait",

    // Object form of the step names, for "Choose ...", "Set ...", "Add ...".
    // English has no inflection, so these repeat the labels above; Polish does,
    // and without them the buttons read like a menu heading rather than a task.
    "stepAcc.species": "Species",
    "stepAcc.background": "Background",
    "stepAcc.class": "Class",
    "stepAcc.abilities": "Ability scores",
    "stepAcc.languages": "Languages",
    "stepAcc.portrait": "Portrait",

    "guide.optional": "optional",
    "guide.whatIsThis": "What is this?",
    "guide.importing":
      "Importing. Work through every window the importer opens, right to the last one - if nothing seems to be happening, one of them may be hidden behind another window.",
    "guide.choose": "Choose {0}",
    "guide.set": "Set {0}",
    "guide.addOptional": "Add {0} (optional)",
    "guide.change": "Change",
    "guide.remove": "Remove",
    "guide.referenceTitle": "Browse the class compendium",
    "guide.referenceBody":
      "The full list of classes and subclasses with their descriptions. Reading only - it picks nothing and changes nothing on your sheet.",
    "guide.referenceButton": "Open the compendium",

    "panel.title": "Class descriptions",
    "panel.searchPlaceholder": "Search classes and subclasses",
    "panel.pick": "Show the list",
    "panel.clear": "Clear",
    "panel.showAll": "Show every class",
    "panel.nothing": "Pick a name in the importer, or choose one above, to read what it does.",
    "panel.empty": "No compendiums to read. Ask your GM which books are available.",
    "panel.noResults": "Nothing matches that.",
    "panel.noDescription": "This entry has no description in the compendium.",
    "panel.readError": "Could not read that entry.",
    "panel.missingEntry": "\"{0}\" is not in the available compendiums. Below are the {1} options that are.",
    "panel.missingClass": "{0} is not in the available compendiums, so there is nothing to read for it here.",
    "guide.levelUp": "Add a level or another class",
    "guide.ready": "Ready to play",
    "guide.toFix": "{0} thing(s) to fix",
    "guide.recheck": "Recheck",
    "guide.allGood": "Everything checks out.",
    "guide.progress": "{0} of {1} steps done",
    "theme.auto": "Foundry",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "guide.panelFailed": "The panel could not be prepared",
    "guide.panelFailedHint": "Something on this character could not be read, so the panel cannot be drawn. The character itself is untouched - open its sheet as usual. Ask your GM to check the console (F12); the reason is logged there.",
    "guide.stepsFailed": "The steps could not be drawn",
    "guide.stepsFailedHint": "Something on this character could not be read. The rest of the panel still works. Ask your GM to check the console (F12) - the reason is logged there.",
    "guide.postToChat": "Post to chat",
    "guide.finalize": "Finalize",
    "guide.finishFirst": "Finish the remaining steps first",
    "guide.multiclass": "Character level {0}, across {1} classes.",
    "guide.languageCount": "{0} languages",
    "guide.languageCountOne": "1 language",
    "guide.portraitSet": "Portrait set",

    "help.name":
      "Just a name for now. You can change it at any time, and nothing else depends on it.",
    "help.species":
      "Your character's ancestry - dwarf, elf, human and so on. It sets size and walking speed, and usually adds something innate: darkvision, a resistance, a small once-per-day ability. Under the 2024 rules your species does NOT change your ability scores; that comes from your background.",
    "help.background":
      "What your character did before adventuring: soldier, sage, criminal. It grants two skill proficiencies, a tool, a starting feat, and the ability score increases - one ability by 2 and another by 1, or three abilities by 1 each. Pick one whose skills suit the character you imagine.",
    "help.class":
      "Your role in the party and the biggest single decision here. It decides how tough you are, what you are trained with, and what you can do in a fight. Fighter and Barbarian are the most forgiving if this is your first character; Wizard and Druid have the most to keep track of. The importer asks for the subclass and the level at the same time, so a character can start above level 1 if your table plays that way - at level 1 there is no subclass yet.",
    "help.abilities":
      "Six numbers describing raw talent. Strength for hitting and lifting, Dexterity for aim and reflexes, Constitution for stamina and hit points, Intelligence for knowledge, Wisdom for perception and willpower, Charisma for force of personality. What matters in play is the modifier next to each score: 10 gives +0, and every two points above or below shifts it by one. Put your highest number in whatever your class uses most.",
    "help.languages":
      "Everyone speaks Common. Your character knows two more, which you can roll for or choose. Languages rarely decide a fight, but they open doors when the party meets someone who does not speak Common.",
    "help.portrait":
      "Optional. A picture for your character, shown on the sheet and on the token.",

    "blurb.species": "Determines your speed, size and innate traits.",
    "blurb.background":
      "Grants proficiencies, an origin feat and ability score increases.",
    "blurb.class": "What your character can do, in combat and out of it.",
    "blurb.abilities": "Importers skip this, so it is done here at the end.",
    "blurb.languages": "Common plus two more. Roll for them or pick from the table.",
    "blurb.portrait":
      "Optional. A picture for your character, shown on the sheet and on the token.",

    "flow.prompt":
      " After you press the button, a small window asks where to take the entry from. Choose Use Plutonium, then press Open Importer in the window that follows - only then do you see the list to pick from.",
    "flow.plutonium": " After you press the button, the list of options opens by itself.",

    "method.standard": "Standard array",
    "method.pointbuy": "Point buy",
    "method.roll": "Rolled 4d6, dropping the lowest",
    "method.manual": "Entered by hand",

    "check.species": "Species",
    "check.speciesHint": "Sets your size, speed and innate traits.",
    "check.background": "Background",
    "check.backgroundHint": "Grants proficiencies and an origin feat.",
    "check.class": "Class at level 1 or higher",
    "check.classHint": "Without it there are no class features.",
    "check.hp": "Hit points above zero",
    "check.hpHint": "Usually means the class advancement was cancelled.",
    "check.speed": "Walking speed set",
    "check.speedHint": "Comes from the species; zero means it never applied.",
    "check.abilities": "Ability scores assigned",
    "check.abilitiesHint": "Importers leave every score at ten. Use the final step.",
    "check.language": "At least one language",
    "check.languageHint": "Most characters know Common.",
    "check.skills": "Skill proficiencies",
    "check.skillsHint": "Background and class normally grant several.",
    "check.inventory": "Something in the inventory",
    "check.inventoryHint": "No starting equipment was taken.",
    "check.portrait": "Portrait chosen",
    "guide.skippedTitle": "Choices were skipped",
    "guide.skippedBody": "The option dialogs for the {0} were closed without picking anything. Are you sure you want to continue? Remove it and add it again to set every option.",
    "guide.skippedFix": "Remove and add the {0} again",

    "check.skipped": "{0}: choices skipped",
    "check.skippedHint": "The option dialogs for the {0} were closed without picking anything.",
    "check.kind.race": "species",
    "check.kind.species": "species",
    "check.kind.background": "background",
    "check.kind.class": "class",
    "check.kind.subclass": "subclass",
    "check.kindOf.race": "species",
    "check.kindOf.species": "species",
    "check.kindOf.background": "background",
    "check.kindOf.class": "class",
    "check.kindOf.subclass": "subclass",
    "option.title": "An option was left unchosen",
    "option.skipped": "The \"{0}\" dialog was closed without choosing anything, so nothing was granted for it.",
    "option.skippedAt": "The \"{0}\" dialog (level {1}) was closed without choosing anything, so nothing was granted for it.",
    "option.partial": "Only {1} of {2} were picked in \"{0}\", so the rest are missing.",
    "option.delevelButton": "Step back to level {0} and choose again",
    "option.delevelTitle": "Step a level back",
    "option.delevelBody": "Undo the most recent level of {0} (currently level {1})? Everything below it stays as it is, and you can level up again straight away.",
    "option.noDelevel": "This version of the system cannot step a level back. Remove the class and add it again instead.",
    "option.dismiss": "I have sorted this out",
    "option.delevelShort": "Step a level back",
    "option.partialAsi": "{1} point(s) were left unspent in \"{0}\".",
    "option.partialSelect": "A choice was left unset in \"{0}\".",
    "check.spells": "Spells on the sheet",
    "check.spellsHint": "This character has spell slots but nothing to cast. The import may have been closed before the spells were picked.",
    "check.multiclass": "Multiclass requirement: {0}",
    "check.multiclassHint": "Taking levels in more than one class normally needs 13 in {0}. Some tables drop this rule - ask your GM.",
    "check.andJoin": " and ",
    "check.orJoin": " or ",
    "check.portraitHint": "Optional, but it helps everyone at the table.",

    "abilities.title": "Ability scores",
    "abilities.lead":
      "For characters built by an importer, which fills in the class, species, background and gear but never asks for ability scores.",
    "abilities.character": "Character",
    "abilities.chooseActor": "— choose —",
    "abilities.previously": "Previously completed",
    "abilities.previouslyOn": "Previously completed on {0}",
    "abilities.previouslyBody":
      "Your earlier assignment is restored below, so applying again will not stack anything twice.",
    "abilities.bonusMeasured": "Bonuses are measured against the base saved last time.",
    "abilities.bonusAdvancements":
      "Bonuses are read from the increases declared on this character's own items; whatever is on the sheet is ignored.",
    "abilities.bonusNone": "The scores are written exactly as assigned, with nothing added.",
    "abilities.methodStandard": "Standard array",
    "abilities.methodPointBuy": "Point buy",
    "abilities.methodRoll": "Roll dice",
    "abilities.methodManual": "Manual",
    "abilities.rollButton": "Roll 4d6, drop lowest",
    "abilities.pointsLeft": "Points remaining",
    "abilities.of": "of",
    "abilities.colAbility": "Ability",
    "abilities.colNow": "Now",
    "abilities.colAssign": "Assign",
    "abilities.colBonus": "Bonus",
    "abilities.colResult": "Result",
    "abilities.colMod": "Mod",
    "abilities.reset": "Reset",
    "abilities.footer": "Only ability scores are touched.",
    "abilities.apply": "Apply",

    "lang.title": "Languages",
    "lang.lead":
      "Your character knows at least three languages: Common plus two languages you roll or choose from the Standard Languages table.",
    "lang.colRoll": "1d12",
    "lang.colLanguage": "Language",
    "lang.colOrigin": "Origin",
    "lang.alwaysKnown": "always known",
    "lang.rolled": "rolled {0}",
    "lang.rollButton": "Roll 1d12",
    "lang.rolledSoFar": "rolled so far",
    "lang.clear": "clear",
    "lang.pick": "Pick your languages",
    "lang.commonNote": "Common is always known. Chosen besides Common:",
    "lang.overLimit": "That is more than the usual two - you will be asked to confirm.",
    "lang.search": "Search languages...",
    "lang.standard": "Standard Languages",
    "lang.expanded": "Expanded",
    "lang.footer": "Only languages are changed. Nothing else on the sheet is touched.",
    "lang.save": "Save"
  },

  pl: {
    "guide.title": "Nowa postać",
    "guide.windowTitle": "Kreator postaci",
    "guide.disclaimerTitle": "Zanim zaczniesz - sprawdź, jak działa kreator postaci",
    "guide.disclaimerSource": "Gatunek, pochodzenie i klasa pochodzą z importera, który nie jest częścią kreatora. Jego okna otwierają się nad tym panelem i zadają własne pytania.",
    "guide.disclaimerComplete": "Przejdź każde z tych okien do końca. Zamknięcie przyciskiem Skip, Cancel albo krzyżykiem zostawia wybór niedokonany, a krok będzie niepełny.",
    "guide.disclaimerWait": "Zaczekaj, aż import się zakończy. Kończy go okno \"Import Complete\" - zamknij je i dopiero wtedy wracaj tutaj.",
    "guide.disclaimerRedo": "Ukończonego kroku nie da się później edytować. Żeby cokolwiek zmienić, usuwasz go i rozpoczynasz od nowa.",
    "guide.intro":
      "Siedem kroków, po kolei. Część z nich przekazuje cię do importera, który otwiera się jako osobne okno nad tym panelem - nie jest częścią kreatora i potrafi zadać kilka własnych pytań. Przejdź przez nie, zamknij je i wróć tutaj: panel pilnuje, co już trafiło na kartę postaci.",
    "guide.missing": "Ta postać już nie istnieje.",
    "guide.ownership": "Właściciel i folder",
    "guide.player": "Gracz",
    "guide.playerHint": "Kto może otwierać i edytować tę postać.",
    "guide.nobody": "— jeszcze nikt —",
    "guide.folder": "Folder",
    "guide.noFolder": "— brak —",
    "guide.setDefaultFolder": "Od teraz twórz nowe postacie w tym folderze",
    "guide.unsetDefaultFolder": "Przestań tu odkładać nowe postacie",
    "guide.defaultFolderIs": "Nowe postacie trafiają do \"{0}\".",
    "guide.noDefaultFolder": "Nowe postacie nie trafiają automatycznie do żadnego folderu.",

    "step.name": "Imię",
    "step.species": "Gatunek",
    "step.background": "Pochodzenie",
    "step.class": "Klasa",
    "step.abilities": "Atrybuty",
    "step.languages": "Języki",
    "step.portrait": "Portret",

    "stepAcc.species": "gatunek",
    "stepAcc.background": "pochodzenie",
    "stepAcc.class": "klasę",
    "stepAcc.abilities": "atrybuty",
    "stepAcc.languages": "języki",
    "stepAcc.portrait": "portret",

    "guide.optional": "opcjonalny",
    "guide.whatIsThis": "Co to jest?",
    "guide.importing":
      "Trwa import. Przejdź przez wszystkie okna, które otwiera importer, aż do ostatniego - jeśli nic się nie dzieje, któreś może być schowane pod innym oknem.",
    "guide.choose": "Wybierz {0}",
    "guide.set": "Ustaw {0}",
    "guide.addOptional": "Dodaj {0} (opcjonalnie)",
    "guide.change": "Zmień",
    "guide.remove": "Usuń",
    "guide.referenceTitle": "Przeglądaj kompendium klas",
    "guide.referenceBody":
      "Pełna lista klas i podklas wraz z opisami. Tylko do czytania - niczego nie wybiera i nic nie zmienia na karcie.",
    "guide.referenceButton": "Otwórz kompendium",

    "panel.title": "Opisy klas",
    "panel.searchPlaceholder": "Szukaj klas i podklas",
    "panel.pick": "Pokaż listę",
    "panel.clear": "Wyczyść",
    "panel.showAll": "Pokaż wszystkie klasy",
    "panel.nothing": "Kliknij nazwę w importerze albo wybierz ją powyżej, żeby przeczytać opis.",
    "panel.empty": "Brak kompendiów do czytania. Zapytaj MG, które podręczniki są dostępne.",
    "panel.noResults": "Nic nie pasuje.",
    "panel.noDescription": "Ten wpis nie ma opisu w kompendium.",
    "panel.readError": "Nie udało się odczytać tego wpisu.",
    "panel.missingEntry": "Nie ma \"{0}\" w dostępnych kompendiach. Poniżej warianty klasy {1}, które są.",
    "panel.missingClass": "Nie ma klasy {0} w dostępnych kompendiach, więc nie ma tu czego czytać.",
    "guide.levelUp": "Dodaj poziom lub kolejną klasę",
    "guide.ready": "Gotowa do gry",
    "guide.toFix": "Do poprawienia: {0}",
    "guide.recheck": "Sprawdź ponownie",
    "guide.allGood": "Wszystko się zgadza.",
    "guide.progress": "Ukończono {0} z {1} kroków",
    "theme.auto": "Foundry",
    "theme.light": "Jasny",
    "theme.dark": "Ciemny",
    "guide.panelFailed": "Nie udało się przygotować panelu",
    "guide.panelFailedHint": "Czegoś na tej postaci nie dało się odczytać, więc panel nie może się narysować. Sama postać jest nienaruszona - otwórz jej kartę normalnie. Poproś MG o sprawdzenie konsoli (F12), powód jest tam zapisany.",
    "guide.stepsFailed": "Nie udało się narysować kroków",
    "guide.stepsFailedHint": "Czegoś na tej postaci nie dało się odczytać. Reszta panelu działa. Poproś MG o sprawdzenie konsoli (F12) - powód jest tam zapisany.",
    "guide.postToChat": "Wyślij na czat",
    "guide.finalize": "Zakończ",
    "guide.finishFirst": "Najpierw dokończ pozostałe kroki",
    "guide.multiclass": "Poziom postaci: {0}, rozłożony na {1} klas(y).",
    "guide.languageCount": "Języki: {0}",
    "guide.languageCountOne": "1 język",
    "guide.portraitSet": "Portret ustawiony",

    "help.name":
      "Wpisz cokolwiek - to tylko imię. Możesz je zmienić w dowolnym momencie i nic innego od niego nie zależy.",
    "help.species":
      "Rodowód twojej postaci - krasnolud, elf, człowiek i tak dalej. Określa rozmiar i szybkość marszu, zwykle dodaje też coś wrodzonego: widzenie w ciemności, odporność, drobną zdolność raz na dzień. W zasadach z 2024 gatunek NIE zmienia atrybutów - te podnosi pochodzenie.",
    "help.background":
      "Czym twoja postać zajmowała się przed przygodą: żołnierz, uczony, przestępca. Daje dwie biegłości w umiejętnościach, narzędzie, atut startowy oraz podwyższenia atrybutów - jeden o 2 i drugi o 1 albo trzy po 1. Wybierz takie, którego umiejętności pasują do postaci, jaką sobie wyobrażasz.",
    "help.class":
      "Twoja rola w drużynie i największa decyzja w całym procesie. Określa, ile wytrzymasz, czym umiesz walczyć i co potrafisz w starciu. Wojownik i Barbarzyńca najłatwiej wybaczają błędy przy pierwszej postaci; Czarodziej i Druid wymagają pilnowania największej liczby rzeczy. Importer pyta jednocześnie o podklasę i poziom, więc postać może zaczynać wyżej niż na pierwszym - na pierwszym poziomie podklasy jeszcze nie ma.",
    "help.abilities":
      "Sześć liczb opisujących surowy talent. Siła do ciosów i dźwigania, Zręczność do celności i refleksu, Kondycja do wytrzymałości i punktów życia, Inteligencja do wiedzy, Mądrość do spostrzegawczości i silnej woli, Charyzma do siły osobowości. W grze liczy się modyfikator obok wyniku: 10 daje +0, a każde dwa punkty w górę lub w dół przesuwają go o jeden. Najwyższy wynik wpisz w ten atrybut, z którego twoja klasa korzysta najczęściej.",
    "help.languages":
      "Wspólnym mówią wszyscy. Twoja postać zna jeszcze dwa języki - możesz je wylosować albo wybrać. Języki rzadko rozstrzygają walkę, ale otwierają drzwi, gdy drużyna spotka kogoś, kto nie mówi Wspólnym.",
    "help.portrait":
      "Nieobowiązkowy. Obrazek twojej postaci, widoczny na karcie i na żetonie.",

    "blurb.species": "Określa szybkość, rozmiar i cechy wrodzone.",
    "blurb.background": "Daje biegłości, atut startowy i podwyższenia atrybutów.",
    "blurb.class": "Co twoja postać potrafi w walce i poza nią.",
    "blurb.abilities": "Importery pomijają ten krok, więc robimy go tutaj, na końcu.",
    "blurb.languages": "Wspólny plus dwa kolejne. Wylosuj je albo wybierz z tabeli.",
    "blurb.portrait": "Nieobowiązkowy. Obrazek widoczny na karcie i na żetonie.",

    "flow.prompt":
      " Po naciśnięciu przycisku pojawi się małe okno z pytaniem o źródło. Wybierz Use Plutonium, potem naciśnij Open Importer w kolejnym oknie - dopiero wtedy zobaczysz listę do wyboru.",
    "flow.plutonium": " Po naciśnięciu przycisku lista opcji otworzy się sama.",

    "method.standard": "Zestaw standardowy",
    "method.pointbuy": "Zakup punktowy",
    "method.roll": "Rzut 4k6 z odrzuceniem najniższej",
    "method.manual": "Wpisane ręcznie",

    "check.species": "Gatunek",
    "check.speciesHint": "Określa rozmiar, szybkość i cechy wrodzone.",
    "check.background": "Pochodzenie",
    "check.backgroundHint": "Daje biegłości i atut startowy.",
    "check.class": "Klasa na 1. poziomie lub wyższym",
    "check.classHint": "Bez niej postać nie ma żadnych zdolności klasowych.",
    "check.hp": "Punkty życia powyżej zera",
    "check.hpHint": "Zwykle oznacza, że przerwano okno rozwoju przy dodawaniu klasy.",
    "check.speed": "Ustawiona szybkość",
    "check.speedHint": "Pochodzi od gatunku; zero oznacza, że gatunek nigdy się nie zastosował.",
    "check.abilities": "Przypisane atrybuty",
    "check.abilitiesHint": "Importery zostawiają wszędzie dziesiątki. Użyj ostatniego kroku.",
    "check.language": "Przynajmniej jeden język",
    "check.languageHint": "Większość postaci zna Wspólny.",
    "check.skills": "Biegłości w umiejętnościach",
    "check.skillsHint": "Pochodzenie i klasa zwykle dają ich kilka.",
    "check.inventory": "Coś w ekwipunku",
    "check.inventoryHint": "Nie wzięto ekwipunku startowego.",
    "check.portrait": "Wybrany portret",
    "guide.skippedTitle": "Pominięto wybory",
    "guide.skippedBody": "Zamknięto okna opcji dla {0} bez wskazania wyboru. Na pewno chcesz kontynuować? Usuń i dodaj ponownie, by określić wszystkie opcje.",
    "guide.skippedFix": "Usuń i dodaj ponownie ({0})",

    "check.skipped": "{0}: pominięte wybory",
    "check.skippedHint": "Zamknięto okna opcji dla {0} bez wskazania wyboru.",
    "check.kind.race": "gatunek",
    "check.kind.species": "gatunek",
    "check.kind.background": "pochodzenie",
    "check.kind.class": "klasa",
    "check.kind.subclass": "podklasa",
    "check.kindOf.race": "gatunku",
    "check.kindOf.species": "gatunku",
    "check.kindOf.background": "pochodzenia",
    "check.kindOf.class": "klasy",
    "check.kindOf.subclass": "podklasy",
    "option.title": "Opcja została bez wyboru",
    "option.skipped": "Okno \"{0}\" zamknięto bez wskazania wyboru, więc nic z niego nie zostało przyznane.",
    "option.skippedAt": "Okno \"{0}\" (poziom {1}) zamknięto bez wskazania wyboru, więc nic z niego nie zostało przyznane.",
    "option.partial": "W oknie \"{0}\" wybrano tylko {1} z {2}, więc reszty brakuje.",
    "option.delevelButton": "Cofnij do poziomu {0} i wybierz ponownie",
    "option.delevelTitle": "Cofnięcie poziomu",
    "option.delevelBody": "Cofnąć ostatni poziom klasy {0} (obecnie poziom {1})? Wszystko poniżej zostaje bez zmian, a awans można powtórzyć od razu.",
    "option.noDelevel": "Ta wersja systemu nie potrafi cofnąć poziomu. Usuń klasę i dodaj ją ponownie.",
    "option.dismiss": "Już to poprawiłem",
    "option.delevelShort": "Cofnij poziom",
    "option.partialAsi": "W oknie \"{0}\" nie rozdzielono {1} pkt.",
    "option.partialSelect": "W oknie \"{0}\" nie wskazano wyboru z listy.",
    "check.spells": "Zaklęcia na karcie",
    "check.spellsHint": "Ta postać ma komórki zaklęć, ale nie ma czego rzucać. Import mógł zostać zamknięty przed wyborem zaklęć.",
    "check.multiclass": "Wymagania wieloklasowości: {0}",
    "check.multiclassHint": "Łączenie klas zwykle wymaga 13 w {0}. Część stołów rezygnuje z tej zasady - zapytaj MG.",
    "check.andJoin": " i ",
    "check.orJoin": " albo ",
    "check.portraitHint": "Opcjonalny, ale ułatwia życie całemu stołowi.",

    "abilities.title": "Atrybuty",
    "abilities.lead":
      "Dla postaci zbudowanych importerem, który wypełnia klasę, gatunek, pochodzenie i ekwipunek, ale nigdy nie pyta o atrybuty.",
    "abilities.character": "Postać",
    "abilities.chooseActor": "— wybierz —",
    "abilities.previously": "Uzupełniano już wcześniej",
    "abilities.previouslyOn": "Uzupełniano już wcześniej: {0}",
    "abilities.previouslyBody":
      "Poprzednie przypisanie zostało przywrócone poniżej, więc ponowne zatwierdzenie niczego nie naliczy dwa razy.",
    "abilities.bonusMeasured": "Premie liczone względem bazy zapisanej ostatnim razem.",
    "abilities.bonusAdvancements":
      "Premie odczytane z podwyższeń zadeklarowanych w przedmiotach tej postaci; to, co jest na karcie, jest pomijane.",
    "abilities.bonusNone": "Wartości zostaną wpisane dokładnie tak, jak je przydzielisz, bez doliczania czegokolwiek.",
    "abilities.methodStandard": "Zestaw standardowy",
    "abilities.methodPointBuy": "Zakup punktowy",
    "abilities.methodRoll": "Rzut kośćmi",
    "abilities.methodManual": "Ręcznie",
    "abilities.rollButton": "Rzuć 4k6, odrzuć najniższą",
    "abilities.pointsLeft": "Pozostało punktów",
    "abilities.of": "z",
    "abilities.colAbility": "Atrybut",
    "abilities.colNow": "Obecnie",
    "abilities.colAssign": "Przydziel",
    "abilities.colBonus": "Premia",
    "abilities.colResult": "Wynik",
    "abilities.colMod": "Mod.",
    "abilities.reset": "Wyczyść",
    "abilities.footer": "Zmieniane są wyłącznie atrybuty.",
    "abilities.apply": "Zatwierdź",

    "lang.title": "Języki",
    "lang.lead":
      "Twoja postać zna co najmniej trzy języki: Wspólny oraz dwa, które wylosujesz albo wybierzesz z tabeli języków standardowych.",
    "lang.colRoll": "1k12",
    "lang.colLanguage": "Język",
    "lang.colOrigin": "Pochodzenie",
    "lang.alwaysKnown": "znany zawsze",
    "lang.rolled": "wylosowano {0}",
    "lang.rollButton": "Rzuć 1k12",
    "lang.rolledSoFar": "dotychczasowe rzuty",
    "lang.clear": "wyczyść",
    "lang.pick": "Wybierz języki",
    "lang.commonNote": "Wspólny znasz zawsze. Poza nim wybrano:",
    "lang.overLimit": "To więcej niż zwyczajowe dwa - zapytamy o potwierdzenie przed zapisem.",
    "lang.search": "Szukaj języków...",
    "lang.standard": "Języki standardowe",
    "lang.expanded": "Języki rozszerzone",
    "lang.footer": "Zmieniane są wyłącznie języki. Reszta karty pozostaje nietknięta.",
    "lang.save": "Zapisz"
  }
};

/** Language actually in force: the player's own choice, else the world default. */
export function currentLanguage() {
  try {
    const mine = game.settings.get(MODULE_ID, "language");
    if (mine && mine !== "auto") return mine;
    return game.settings.get(MODULE_ID, "defaultLanguage") || "en";
  } catch (err) {
    return "en";
  }
}

/** Translated string, with {0}, {1}... replaced by the arguments given. */
export function t(key, ...args) {
  const lang = currentLanguage();
  const text = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  return args.length
    ? text.replace(/\{(\d+)\}/g, (match, index) => args[index] ?? match)
    : text;
}

export const LANGUAGE_CHOICES = { en: "English", pl: "Polski" };

/** Makes {{pkT "key"}} available inside the templates. */
export function registerTranslationHelper() {
  if (typeof Handlebars === "undefined") return;
  Handlebars.registerHelper("pkT", (key, ...rest) => {
    const args = rest.slice(0, -1);
    return t(key, ...args);
  });
}
