import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DEFAULT_DB_PATH = path.resolve(
  process.cwd(),
  '..',
  'database',
  'mitarbeiter.db'
);

function resolveDbPath(): string {
  const configured = process.env.DATABASE_PATH;
  const dbPath = configured ? path.resolve(configured) : DEFAULT_DB_PATH;

  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `SQLite database not found at "${dbPath}". ` +
        'Set DATABASE_PATH in your environment if the file lives elsewhere.'
    );
  }

  return dbPath;
}

export type SqliteDatabase = Database.Database;

declare global {
  var __stundenlisteDb: SqliteDatabase | undefined;
}

export function getDb(): SqliteDatabase {
  if (!global.__stundenlisteDb) {
    const dbPath = resolveDbPath();
    global.__stundenlisteDb = new Database(dbPath, {
      fileMustExist: true,
      verbose: process.env.NODE_ENV === 'development' ? console.debug : undefined,
    });
    global.__stundenlisteDb.pragma('journal_mode = WAL');
  }

  ensureSchema(global.__stundenlisteDb);
  return global.__stundenlisteDb;
}

export function closeDb(): void {
  if (global.__stundenlisteDb) {
    global.__stundenlisteDb.close();
    global.__stundenlisteDb = undefined;
  }
}

function ensureSchema(db: SqliteDatabase) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS shift_plan_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        day_date TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        required_pause_minutes INTEGER NOT NULL DEFAULT 0,
        label TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, day_date)
      );
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_shift_plan_days_employee_date
      ON shift_plan_days(employee_id, day_date);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS shift_plan_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        employee_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const templateColumns = db.prepare(`PRAGMA table_info(shift_plan_templates)`).all() as { name: string }[];
    const templateColumnNames = new Set(templateColumns.map((info) => info.name));
    if (!templateColumnNames.has('employee_id')) {
      db.exec(`ALTER TABLE shift_plan_templates ADD COLUMN employee_id INTEGER;`);
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_shift_plan_templates_employee
      ON shift_plan_templates(employee_id);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS shift_plan_template_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id INTEGER NOT NULL,
        weekday INTEGER NOT NULL,
        segment_index INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL,
        start_time TEXT,
        end_time TEXT,
        required_pause_minutes INTEGER NOT NULL DEFAULT 0,
        label TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (template_id) REFERENCES shift_plan_templates(id) ON DELETE CASCADE,
        UNIQUE(template_id, weekday, segment_index)
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_shift_plan_template_days_template
      ON shift_plan_template_days(template_id, weekday, segment_index);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        slug TEXT,
        timezone TEXT,
        address_line1 TEXT,
        address_line2 TEXT,
        postal_code TEXT,
        city TEXT,
        country TEXT,
        phone TEXT,
        email TEXT,
        metadata TEXT,
        opening_hours TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const branchColumns = db.prepare(`PRAGMA table_info(branches)`).all() as { name: string }[];
    const branchColumnNames = new Set(branchColumns.map((info) => info.name));
    const ensureBranchColumn = (column: string, definition: string) => {
      if (branchColumnNames.has(column)) {
        return;
      }
      if (column === 'updated_at') {
        db.exec(`ALTER TABLE branches ADD COLUMN updated_at TEXT;`);
        db.exec(`UPDATE branches SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL;`);
      } else {
        db.exec(`ALTER TABLE branches ADD COLUMN ${definition};`);
      }
      branchColumnNames.add(column);
    };

    ensureBranchColumn('slug', 'slug TEXT');
    ensureBranchColumn('timezone', "timezone TEXT DEFAULT 'Europe/Berlin'");
    ensureBranchColumn('address_line1', 'address_line1 TEXT');
    ensureBranchColumn('address_line2', 'address_line2 TEXT');
    ensureBranchColumn('postal_code', 'postal_code TEXT');
    ensureBranchColumn('city', 'city TEXT');
    ensureBranchColumn('country', "country TEXT DEFAULT 'DE'");
    ensureBranchColumn('phone', 'phone TEXT');
    ensureBranchColumn('email', 'email TEXT');
    ensureBranchColumn('metadata', 'metadata TEXT');
    ensureBranchColumn('opening_hours', 'opening_hours TEXT');
    ensureBranchColumn('updated_at', 'updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP');
    ensureBranchColumn('street', 'street TEXT');

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_slug
      ON branches(slug)
      WHERE slug IS NOT NULL AND slug <> ''
    `);

    const slugify = (value: string) =>
      value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');

    const existingBranches = db
      .prepare(
        `SELECT id, name, slug, street, address_line1, postal_code, city, timezone, country
         FROM branches`
      )
      .all() as Array<{
        id: number;
        name: string;
        slug: string | null;
        street: string | null;
        address_line1: string | null;
        postal_code: string | null;
        city: string | null;
        timezone: string | null;
        country: string | null;
      }>;

    const seenSlugs = new Set<string>(
      existingBranches
        .map((branch) => (branch.slug ?? '').trim())
        .filter((slug) => Boolean(slug))
    );

    const updateBranchStmt = db.prepare(
      `UPDATE branches
       SET slug = ?,
           address_line1 = ?,
           postal_code = ?,
           city = ?,
           timezone = ?,
           country = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    );

    for (const branch of existingBranches) {
      const currentSlug = (branch.slug ?? '').trim();
      let slug = currentSlug;
      if (!slug) {
        const base = slugify(branch.name || `standort-${branch.id}`) || `standort-${branch.id}`;
        let candidate = base;
        let counter = 1;
        while (seenSlugs.has(candidate)) {
          counter += 1;
          candidate = `${base}-${counter}`;
        }
        slug = candidate;
        seenSlugs.add(slug);
      }

      const currentAddressLine1 = (branch.address_line1 ?? '').trim();
      const currentPostalCode = (branch.postal_code ?? '').trim();
      const currentCity = (branch.city ?? '').trim();
      const currentTimezone = (branch.timezone ?? '').trim();
      const currentCountry = (branch.country ?? '').trim();

      const addressLine1 = currentAddressLine1 || (branch.street ?? '').trim() || '';
      const postalCode = currentPostalCode;
      const city = currentCity;
      const timezone = currentTimezone || 'Europe/Berlin';
      const country = currentCountry || 'DE';

      const needsUpdate =
        slug !== currentSlug ||
        addressLine1 !== currentAddressLine1 ||
        postalCode !== currentPostalCode ||
        city !== currentCity ||
        timezone !== currentTimezone ||
        country !== currentCountry;

      if (needsUpdate) {
        updateBranchStmt.run(
          slug,
          addressLine1 || null,
          postalCode || null,
          city || null,
          timezone,
          country,
          branch.id
        );
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS branch_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        branch_id INTEGER NOT NULL,
        weekday INTEGER NOT NULL,
        segment_index INTEGER NOT NULL DEFAULT 0,
        starts_at_minutes INTEGER,
        ends_at_minutes INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        UNIQUE(branch_id, weekday, segment_index)
      );
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_branch_schedules_branch_weekday
      ON branch_schedules(branch_id, weekday)
    `);

    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(`
      CREATE TABLE IF NOT EXISTS employee_branches (
        employee_id INTEGER NOT NULL,
        branch_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (employee_id, branch_id),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      );
    `);

    const columns = db.prepare(`PRAGMA table_info(employees)`).all() as { name: string }[];
    const hasIsActive = columns.some((column) => column.name === 'is_active');
    if (!hasIsActive) {
      db.exec(`ALTER TABLE employees ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;`);
      db.exec(`UPDATE employees SET is_active = 1 WHERE is_active IS NULL;`);
    }
    const hasMandatoryPause = columns.some((column) => column.name === 'mandatory_pause_enabled');
    if (!hasMandatoryPause) {
      db.exec(`ALTER TABLE employees ADD COLUMN mandatory_pause_enabled INTEGER NOT NULL DEFAULT 0;`);
    }
    const hasBookingPin = columns.some((column) => column.name === 'booking_pin');
    if (!hasBookingPin) {
      db.exec(`ALTER TABLE employees ADD COLUMN booking_pin TEXT NOT NULL DEFAULT '0000';`);
    }
    const hasVacationDaysTotal = columns.some((column) => column.name === 'vacation_days_total');
    if (!hasVacationDaysTotal) {
      db.exec(`ALTER TABLE employees ADD COLUMN vacation_days_total INTEGER NOT NULL DEFAULT 20;`);
      db.exec(
        `UPDATE employees
         SET vacation_days_total = COALESCE(vacation_days_total, vacation_days, 20)`
      );
    }
    const hasCalendarVisibility = columns.some((column) => column.name === 'show_in_calendar');
    if (!hasCalendarVisibility) {
      db.exec(`ALTER TABLE employees ADD COLUMN show_in_calendar INTEGER NOT NULL DEFAULT 1;`);
    }
    const hasKinderfreibetrag = columns.some((column) => column.name === 'kinderfreibetrag');
    if (!hasKinderfreibetrag) {
      db.exec(`ALTER TABLE employees ADD COLUMN kinderfreibetrag REAL DEFAULT 0;`);
    }
    const hasIban = columns.some((column) => column.name === 'iban');
    if (!hasIban) {
      db.exec(`ALTER TABLE employees ADD COLUMN iban TEXT`);
    }
    const hasBic = columns.some((column) => column.name === 'bic');
    if (!hasBic) {
      db.exec(`ALTER TABLE employees ADD COLUMN bic TEXT`);
    }
    const ensureEmployeeColumn = (name: string, definition: string) => {
      const exists = columns.some((column) => column.name === name);
      if (!exists) {
        db.exec(`ALTER TABLE employees ADD COLUMN ${definition};`);
      }
    };

    ensureEmployeeColumn('steuer_id', 'steuer_id TEXT');
    ensureEmployeeColumn('social_security_number', 'social_security_number TEXT');
    ensureEmployeeColumn('health_insurance', 'health_insurance TEXT');
    ensureEmployeeColumn('health_insurance_number', 'health_insurance_number TEXT');
    ensureEmployeeColumn('nationality', 'nationality TEXT');
    ensureEmployeeColumn('marital_status', 'marital_status TEXT');
    ensureEmployeeColumn('employment_type', 'employment_type TEXT');
    ensureEmployeeColumn('work_time_model', 'work_time_model TEXT');
    ensureEmployeeColumn('probation_months', 'probation_months INTEGER');
    ensureEmployeeColumn('tarif_group', 'tarif_group TEXT');
    ensureEmployeeColumn('emergency_contact_name', 'emergency_contact_name TEXT');
    ensureEmployeeColumn('emergency_contact_phone', 'emergency_contact_phone TEXT');
    ensureEmployeeColumn('emergency_contact_relation', 'emergency_contact_relation TEXT');

    const employeePins = db
      .prepare<[], { id: number; booking_pin: string | null }>('SELECT id, booking_pin FROM employees ORDER BY id')
      .all() as { id: number; booking_pin: string | null }[];
    const usedPins = new Set<string>();
    let pinCounter = 0;
    const nextAvailablePin = () => {
      while (pinCounter < 10000) {
        const candidate = pinCounter.toString().padStart(4, '0');
        pinCounter += 1;
        if (!usedPins.has(candidate)) {
          return candidate;
        }
      }
      throw new Error('Exceeded available Buchungs-PIN range (0000-9999).');
    };

    const updatePinStmt = db.prepare('UPDATE employees SET booking_pin = ? WHERE id = ?');
    for (const employee of employeePins) {
      let pin = (employee.booking_pin ?? '').trim();
      if (!/^\d{4}$/.test(pin) || usedPins.has(pin)) {
        pin = nextAvailablePin();
        updatePinStmt.run(pin, employee.id);
      }
      usedPins.add(pin);
    }

    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_booking_pin ON employees(booking_pin);`);
    const hasFederalState = columns.some((column) => column.name === 'federal_state');
    if (!hasFederalState) {
      db.exec(`ALTER TABLE employees ADD COLUMN federal_state TEXT`);
    }

    const shiftPlanColumns = db.prepare(`PRAGMA table_info(shift_plan_days)`).all() as { name: string }[];
    const hasShiftBranch = shiftPlanColumns.some((column) => column.name === 'branch_id');
    if (!hasShiftBranch) {
      db.exec(`ALTER TABLE shift_plan_days ADD COLUMN branch_id INTEGER`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_shift_plan_days_branch ON shift_plan_days(branch_id)`);

    const dailyDayColumns = db.prepare(`PRAGMA table_info(daily_days)`).all() as { name: string }[];
    const ensureDailyDayColumn = (name: string, definition: string) => {
      const exists = dailyDayColumns.some((column) => column.name === name);
      if (!exists) {
        db.exec(`ALTER TABLE daily_days ADD COLUMN ${definition};`);
      }
    };

    ensureDailyDayColumn('admin_last_change_at', 'admin_last_change_at TEXT');
    ensureDailyDayColumn('admin_last_change_by', 'admin_last_change_by TEXT');
    ensureDailyDayColumn('admin_last_change_type', "admin_last_change_type TEXT DEFAULT ''");
    ensureDailyDayColumn('admin_last_change_summary', "admin_last_change_summary TEXT DEFAULT ''");

    db.exec(`
      CREATE TABLE IF NOT EXISTS employee_weekday_pauses (
        employee_id INTEGER NOT NULL,
        weekday INTEGER NOT NULL,
        minutes INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (employee_id, weekday),
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      );
    `);
  } catch (error) {
    console.error('Failed to ensure database schema', error);
  }
}
