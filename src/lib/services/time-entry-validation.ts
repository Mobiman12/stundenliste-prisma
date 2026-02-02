import {
  calculateIstHours,
  calculateLegalPauseHours,
  pauseStringToMinutes,
  parseTimeString,
  timeToDecimalHours,
} from '@/lib/services/time-calculations';
import type { PlanHoursInfo } from '@/lib/services/shift-plan';

const ABSENCE_CODES = new Set(['U', 'UH', 'K', 'KK', 'KR', 'KKR', 'KU', 'FT', 'ubF', 'Ü']);

export interface TimeEntryValidationParams {
  kommt1: string | null;
  geht1: string | null;
  kommt2: string | null;
  geht2: string | null;
  pause: string | null;
  code: string | null;
  mittag: string | null;
  planInfo: PlanHoursInfo | null;
  minPauseUnder6Minutes: number;
  requiresMealFlag: boolean;
}

export interface TimeEntryValidationResult {
  errors: string[];
  warnings: string[];
  istHours: number;
  rawHours: number;
  pauseMinutes: number;
}

function isAbsenceCode(code: string | null): boolean {
  if (!code) return false;
  return ABSENCE_CODES.has(code.trim().toUpperCase());
}

export function validateTimeEntry(params: TimeEntryValidationParams): TimeEntryValidationResult {
  const code = (params.code ?? '').trim().toUpperCase();
  const mittag = (params.mittag ?? '').trim();
  const pauseMinutes = pauseStringToMinutes(params.pause);

  const kommt1Time = parseTimeString(params.kommt1 ?? undefined);
  const geht1Time = parseTimeString(params.geht1 ?? undefined);
  const kommt2Time = parseTimeString(params.kommt2 ?? undefined);
  const geht2Time = parseTimeString(params.geht2 ?? undefined);

  const errors: string[] = [];
  const warnings: string[] = [];

  const toMinutes = (time: ReturnType<typeof parseTimeString>) =>
    time ? Math.round(timeToDecimalHours(time) * 60) : null;

  const kommt1Minutes = toMinutes(kommt1Time);
  const geht1Minutes = toMinutes(geht1Time);
  const kommt2Minutes = toMinutes(kommt2Time);
  const geht2Minutes = toMinutes(geht2Time);

  if ((kommt1Minutes !== null && geht1Minutes === null) || (kommt1Minutes === null && geht1Minutes !== null)) {
    errors.push('Bitte Kommt 1 und Geht 1 vollständig eintragen.');
  }

  if ((kommt2Minutes !== null && geht2Minutes === null) || (kommt2Minutes === null && geht2Minutes !== null)) {
    errors.push('Bitte Kommt 2 und Geht 2 vollständig eintragen oder beide leer lassen.');
  }

  if (kommt1Minutes !== null && geht1Minutes !== null && kommt1Minutes >= geht1Minutes) {
    errors.push('Geht 1 muss nach Kommt 1 liegen.');
  }

  if (kommt2Minutes !== null && geht2Minutes !== null) {
    if (kommt2Minutes >= geht2Minutes) {
      errors.push('Geht 2 muss nach Kommt 2 liegen.');
    }
    if (kommt1Minutes !== null && geht1Minutes !== null && geht1Minutes > kommt2Minutes) {
      errors.push('Kommt 2 muss nach Geht 1 liegen. Bitte die Zeiten prüfen.');
    }
  }

  const istResult = calculateIstHours(
    params.kommt1,
    params.geht1,
    params.kommt2,
    params.geht2,
    params.pause
  );

  const absence = isAbsenceCode(code);

  if (!absence) {
    if (istResult.netHours <= 0.01) {
      errors.push('Kein gültiger Arbeitszeitraum erfasst. Bitte Kommt- und Gehtzeiten eintragen oder einen passenden Code wählen (z. B. U, KR).');
    }
  }

  const planSoll = params.planInfo?.sollHours ?? 0;
  if (!absence && planSoll > 0 && istResult.netHours + 0.01 < planSoll) {
    if (!code) {
      errors.push(
        `Es wurden ${istResult.netHours.toFixed(2).replace('.', ',')} h erfasst, geplant waren ${planSoll.toFixed(2).replace('.', ',')} h. Bitte gib im Feld Code einen Grund an.`
      );
    } else {
      warnings.push(
        `Es wurden ${istResult.netHours.toFixed(2).replace('.', ',')} h erfasst, geplant waren ${planSoll.toFixed(2).replace('.', ',')} h.`
      );
    }
  }

  if (!absence) {
    const legalPauseMinutes = calculateLegalPauseHours(istResult.rawHours) * 60;
    if (legalPauseMinutes >= 30 && pauseMinutes + 0.9 < legalPauseMinutes) {
      errors.push(
        `Bei ${istResult.rawHours.toFixed(2).replace('.', ',')} h Arbeitszeit sind gemäß § 4 ArbZG mindestens ${legalPauseMinutes} Minuten Pause erforderlich.`
      );
    }

    if (params.planInfo?.requiredPauseMinutes && code === 'RA') {
      const required = params.planInfo.requiredPauseMinutes;
      if (pauseMinutes + 0.9 < required) {
        errors.push(
          `Der Schichtplan verlangt mindestens ${required} Minuten Pause, erfasst sind jedoch nur ${pauseMinutes} Minuten.`
        );
      }
    }

    const planHasExplicitZeroPause = params.planInfo?.requiredPauseMinutes === 0;
    const mandatoryPauseSetting = Math.max(params.minPauseUnder6Minutes ?? 0, 0);
    if (
      code === 'RA' &&
      mandatoryPauseSetting > legalPauseMinutes &&
      legalPauseMinutes >= 30 &&
      pauseMinutes + 0.9 < mandatoryPauseSetting &&
      !planHasExplicitZeroPause
    ) {
      errors.push(
        `Für Dienste mit gesetzlicher Pause sind mindestens ${mandatoryPauseSetting} Minuten hinterlegt.`
      );
    }
  }

  if (params.requiresMealFlag && !absence) {
    const enforceMeal = istResult.rawHours > 6;
    if (enforceMeal) {
      if (mittag.toLowerCase() !== 'ja') {
        errors.push('Da Sachbezug Verpflegung aktiviert ist, muss „Verpflegung“ auf „Ja“ gesetzt werden.');
      } else if (pauseMinutes < 30) {
        warnings.push('Verpflegung wurde bestätigt, die erfasste Pause liegt jedoch unter 30 Minuten.');
      }
    }
  }

  return {
    errors,
    warnings,
    istHours: istResult.netHours,
    rawHours: istResult.rawHours,
    pauseMinutes,
  };
}
