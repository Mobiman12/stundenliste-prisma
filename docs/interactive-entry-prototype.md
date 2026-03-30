# Interaktiver Erfassungs-Flow – Vorschlag (Wizard/Assistent)

## Zielbild
Eine geführte, „chatartige“ Erfassung im Mitarbeiter-Frontend, die automatisch auf Eingaben reagiert und nur die relevanten Informationen einblendet.

## UX-Idee in Kürze
- Schrittweises, lineares Formular (Wizard) mit Möglichkeit zum Zurückspringen.
- Jeder Schritt präsentiert genau eine Frage/Erfassungseinheit.
- Status `RA` (Reguläre Arbeitszeit) ist Default; Sondercodes (U, K, Ü, …) deaktivieren automatisch nicht passende Sektionen.
- Hinweis- und Validierungslogik erscheinen als Assistenten-Karten direkt im Flow.
- Zwischenstände werden gespeichert (z. B. über formState oder Zwischenspeicherung). Optional: Persistenter Speicher per server action nach jedem Schritt.

## Ablaufplan (Beispiel)

1. **Arbeitsstatus wählen**  
   - Buttons: `RA`, `U`, `UH`, `Ü`, `K`, `KK`, `KR`, `KKR`, `KU`, `FT`, `UBF`  
   - Erst nach Auswahl geht es weiter zum nächsten Schritt  
   - Sonderfälle:  
     - `RA`: Wizard zeigt weiterhin Kommt/Geht und Pause.  
     - `U`, `K`, `KK`: nur Datumsbereich nötig (keine Zeiten, Pause, Verpflegung, Umsatz).  
     - `KR`, `KKR`, `Ü`, `UH`: Datumsbereich (optional), Kommt/Geht, Pause, Verpflegung, Umsatz möglich.  
     - `KU`: IST = SOLL; Kommt/Geht optional.

2. **Datum / Zeitraum**  
   - Für `RA`: einzelne Datumsauswahl (default: Heute).  
   - Für Sondercodes: Kalender-Rangepicker (falls relevant).  
   - Hinweis bei bereits abgeschlossenen Monaten.

3. **Zeiten (Kommt/Geht)**  
   - Nur sichtbar für Codes, die reale Arbeitszeit berücksichtigen (`RA`, `KR`, `KKR`, `Ü`, `UH`, `KU`).  
   - Automatisch aus Schichtplan übernommen; manuelles Editieren erlaubt.  
   - Bei Änderungen: Validierung (Geht > Kommt, logische Abfolge, usw.).

4. **Pause & Verpflegung**  
   - Hinweis-Banner: Planpause vs. gesetzliche Pause vs. Eingabe.  
   - Wenn Mitarbeitender laut Plan keine Pause hat, aber manuell eine einträgt → Assistent fragt: „Du brauchst hier keine Pflichtpause, bist du sicher?“  
   - Verpflegung nur, falls Sachbezugsflag aktiv.  
   - Verpflegungstitel rename von „Mittag“ → „Verpflegung“ (bereits umgesetzt).

5. **Umsatz (optional)**  
   - Eingabefeld akzeptiert `123.45` oder `123,45`.  
   - Nur relevant, wenn Mitarbeitende anwesend.  
   - Bei `U`, `K`, `KK` (abwesend) weglassen.

6. **Bemerkung**  
   - Freitext optional, aber immer verfügbar.

7. **Zusammenfassung**  
   - Anzeige aller Eingaben; bei Sondercodes Visualisierung, welche Felder automatisch ausgeblendet wurden.  
   - Checkboxes: „Buchung speichern“, ggf. „Buchung löschen“ (falls im Bearbeiten-Modus).

## Interaktionsdetails

### Steuerung / Navigation
- Schrittwechsel automatisch nach gültiger Eingabe und optionaler „Weiter“-Button.  
- Fortschrittsleiste („1/5“, „2/5“ …).  
- „Zurück“ jederzeit möglich, Werte bleiben erhalten.  
- Bei Sondercodes: Wechsel zwischen Codes resetet nur relevante Schritte.

### Validierungen & Assistenten-Meldungen
- Negative Szenarien (Pause zu kurz, Verpflegung fehlt bei Sachbezug, keine Zeiten eingetragen bei RA) → Anzeige als Assistenten-Karte („Achtung …“).  
- Hinweis-Meldungen:  
  - „Reguläre Arbeitszeit“ bei RA → Info: „Planzeit übernommen: 08:00 – 16:30, Pause 30 Min.“  
  - Bei `Ü`: „Überstundenabbau. Bitte gib IST-Zeiten ein, verbleibende SOLL-Zeit wird automatisch angepasst.“  
- Feiertage: wenn Code `RA` + Feiertag, Info-Karte mit Option „Trotzdem Arbeiten“ vs. „Feiertag buchen“.  

### Zwischenspeicherung
- `useActionState` kann nach jedem Step ein Partial-Update in einem Draft speichern (Optional: über Server Action `saveDraftAction`).  
- Alternativ: lokaler Zustand + finaler Submit.  
- Empfohlen: Minimally, Client state + final `createAction` beibehalten und nur Draft-Store, wenn erwünscht.

### Technische Basis
- React Client Component mit State-Maschine (z. B. `useReducer` oder `zustand`).  
- UI-Bibliothek:  
  - **Headless UI** Accordion/Transitions oder 
  - **Radix UI** Stepper + Dialog + `Collapsible`.  
  - Animations-Option: `framer-motion` (leichtgewichtig).  
- Form Handling: `react-hook-form` oder eigener State, die am Ende `FormData` an die vorhandene Server Action senden.  
- Für Zwischenfragen: „Assistenten“-Komponente (Box mit Icon, text), z. B. `Alert`-Style.

## Ansprechpartner & nächste Schritte
- Designfinalisierung (Farben, Buttons) – evtl. Abstimmung, ob ein Chat-Look (Bubble) oder klarer Stepper-Look gewünscht ist.  
- Bestätigung, ob Draft-Speichern erwünscht oder finaler Submit reicht.  
- Spezifikation für `Ü` (Stunden vs. Tage Eingabe).  
- Testfälle definieren: RA normal, RA + Feiertag, U-Range, KR mit Mittag, KU (SOLL=IST).

---

> Sobald Feedback vorhanden ist, kann ich den Komponentenprototypen (z. B. `InteractiveEntryWizard`) bauen, bestehende Server Actions einbinden und schrittweise migrieren.  
> Alternative Layouts (FX: Chat-Bubbles vs. Stepper vs. Cards) sind im Anhang optional beschreibbar.

