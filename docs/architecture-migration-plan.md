# Stundenliste Next – Migrationsarchitektur

Diese Notiz fasst die Zielarchitektur zusammen, damit wir die Streamlit-App inkrementell in das Next.js-Projekt überführen können. Sie dient als Leitlinie für die folgenden Implementationsschritte.

## 1. Gesamtstruktur

```
src/
  app/
    (auth)/login/           # Auth Screens
    admin/...
    mitarbeiter/...
    api/...
  lib/
    auth/                   # NextAuth Options, Session Helpers
    data/                   # Low-level DB-Abfragen (drizzle/better-sqlite3)
    services/               # Domänenlogik (Overtime, Schichtplan, Dokumente, Reminder)
    util/                   # Zeit- und Format-Helfer (Port von time_utils etc.)
  components/
    ui/                     # Shared UI (Tables, Forms, Dialoge)
    dashboard/...
  jobs/                     # Background Tasks (Cron, Trigger)
public/uploads/             # Optional: S3-Alternative (lokal)
```

* **Lib/data** bildet die SQLite-Tabellen ab (aktuell `daily_days`, `employees`, `weekly_hours_history`, …). Wir starten mit `better-sqlite3`, migrieren später optional auf Drizzle ORM, sobald Tests green sind.
* **Lib/services** kapselt Business Rules (z. B. gesetzliche Pause, Überstunden-Logik, Monatsabschluss). Die bestehenden Python-Funktionen werden dort 1:1 nachgebaut und mit Jest/Vitest geprüft.
* **App/api** stellt HTTP-Endpunkte für Uploads, Cron, Integrationen (Tillhub) bereit. Die meisten Benutzer-Interaktionen laufen über Server Actions direkt aus den App-Routen.
* **Jobs** kapselt terminierte Prozesse: Monats-Reminder (letzter Tag 18:00), Überstunden-Recalc (bei Datenänderungen), Daten-Sync mit Tillhub.

## 2. Feature-Blöcke & Datenquellen

| Block | Tabellen / Dateien | Services | UI-Routen |
|-------|--------------------|----------|-----------|
| Auth + Session | `admins`, `employees`, `password_resets` | `auth/session.ts`, `auth/password.ts` | `/login`, `/dashboard` |
| Tageserfassung | `daily_days`, `monthly_closings`, `hours_bank` | `services/time-entry`, `services/overtime`, `services/monthly-closing` | `/mitarbeiter`, `/admin/mitarbeitende/[id]` |
| Schichtplan & Soll | `shift_plans`, `employees` | `services/shift-plan` | `/admin/schichtplan` |
| Dokumente | `uploads/employee_*`, `employee_documents?` (Dateisystem), `email_config` | `services/documents`, `services/email` | `/mitarbeiter/dokumente`, `/admin/admin_dokumente` |
| News | `news`, `news_read` | `services/news` | `/mitarbeiter/news`, `/admin/news` |
| Reminder | `reminder_settings`, `reminder_send_log` | `services/reminder` + `jobs/monthly-reminder` | `/admin/erinnerungen` |
| Statistik & Bonus | `employee_bonus`, `bonus_scheme`, `bonus_tiers`, `hours_bank`, Tillhub | `services/statistics`, `services/bonus`, `services/tillhub` | `/mitarbeiter/statistik`, `/admin/statistik` |
| Feedback & Support | SMTP (Secrets), optional DB | `services/email`, `services/feedback` | Floating Button (global) |

## 3. Datenzugriff & Typing

- Als erste Iteration bleiben wir bei `better-sqlite3` mit gespeicherten Prepared Statements (wie bereits in `src/lib/data/daily-days.ts`).
- Für komplexere Queries (Joins, Aggregationen) definieren wir dedizierte „Repository“-Funktionen (z. B. `listDailyDaysWithAggregates`, `getOvertimeSummary`), damit die UI-Komponenten nicht direkt SQL kennen.
- Jede Tabelle bekommt ein Interface unter `src/lib/data/schemas.ts` (z. B. `EmployeeRow`, `DailyDayRow`), sowie Zod-Schemas für Eingaben (`UpsertDailyDayInputSchema`, `ReminderSettingsSchema`).

## 4. Business-Logik (Portierungsplan)

1. **Zeit-Utilities**: Port von `time_utils.parse_time_str`, `_pause_to_hours`, `berechne_ist_stunden` → `src/lib/services/time-calculations.ts` inkl. Unit-Tests.
2. **Überstunden**: Nachbau von `recalc_overtime_for_emp`, Planstunden-Handling, Codes („U“, „UH“, „K“, …). -> `src/lib/services/overtime.ts`.
3. **Monthly Closing**: Funktionen aus `monthly_closing.py` → `services/monthly-closing.ts`, API `POST /api/monthly-closing` (Admin-only).
4. **Schichtplan**: Port `load_existing_plan`, `_get_req_pause_minutes_for_day`, UI als Gantt/Grid → `services/shift-plan.ts`, React-Form.
5. **Dokumente**: Dateiupload via Next.js Route Handler (`POST /api/documents/upload`), Speicherung im Filesystem (lokal) bzw. S3 in Produktion, E-Mail via `nodemailer`.
6. **News & Reminder**: Zod-Validierung, SMTP-Test (Next.js Route Handler), optional Cron-Job (z. B. `node-cron` über separate Script).
7. **Tillhub & Statistik**: HTTP-Clients (axios/fetch), Auth-Token-Handling, Caching (Redis optional), Aggregation Reports.

## 5. UI-Bausteine

- Tabellen & Editing → [TanStack Table](https://tanstack.com/table) + eigene Cell-Editoren für Zeiten/Pausen.
- Form Handling → React Hook Form + Zod Resolver.
- Dialoge / Sheets → Radix UI (Dialog, Drawer) oder HeadlessUI.
- Charts → Recharts oder Chart.js für Monatsstatistik.
- File Preview → `<object>`/PDF-Viewer, Next Image.

## 6. Sicherheit & Zugriff

- NextAuth Credentials Provider (bereits vorhanden) + `middleware.ts` schützt `/admin/*`, `/mitarbeiter/*`, `/dashboard`.
- Zusätzliche Guards in Server Actions (z. B. `requireAdmin`, `requireEmployee`).
- Rate Limiting / CSRF: Bei Bedarf `@upstash/ratelimit` oder NextAuth `csrfToken`.
- Passwort-Reset: API `POST /api/auth/request-reset`, `POST /api/auth/reset` mit Token-Validierung.

## 7. Background Processing

- Reminder: Node Script `node jobs/run-reminder.ts` (Cronjob auf Server), nutzt Service `services/reminder.ts`.
- Überstunden-Recalc: Wird bei jeder relevanten Mutation getriggert (Server Action ruft `recalcOvertimeForEmployee`). Zusätzlich manuelle Admin-Option.
- Tillhub-Sync: Geplantes Skript `jobs/tillhub-sync.ts`, schreibt in `tillhub_sales.db` oder vereinheitlichte Tabelle.

## 8. Deployment-Blueprint

- Development: `npm run dev -- --port 3001`.
- Build/Prod: `npm run build`, `npm run start` (oder Docker `node:18-alpine`).
- Environment Variablen: `.env` mit `DATABASE_PATH`, `NEXTAUTH_SECRET`, `SMTP_*`, `TILLHUB_*`.
- Dateispeicher: Lokal `uploads/`, auf Alfahosting via NFS oder S3-kompatibler Dienst.
- Reverse Proxy (Caddy) analog zur Salon-App (`app.stundenliste.de` o. ä.).

## 9. Umsetzungsschritte (Backlog)

1. **Zeitberechnung & Overtime-Service** (inkl. Tests) – Grundlage für Tageserfassung.
2. **Server Actions/Endpoints** für Tageserfassung (CRUD, Recalc, Monatsabschluss-Sperren).
3. **UI Mitarbeiter-Tageserfassung** mit Table + Form.
4. **Admin Mitarbeiter-Detail** (Monatskennzahlen, Overtime, Dokumente).
5. **Dokumenten-Upload + Admin-Downloads + Mail**.
6. **News/Reminder Module**.
7. **Schichtplan-Editor & Sollstunden**.
8. **Statistik & Tillhub**.

Dieses Dokument dient als Referenz, während wir Schritt für Schritt implementieren. Aktualisierungen begrüßt, sobald Entscheidungen fallen oder neue Anforderungen auftauchen.
