"use client";

import { useMemo, useState } from "react";

import { evaluatePasswordPolicy, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

type ResetPasswordFormProps = {
  token: string;
  actionUrl: string;
};

const UPPERCASE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWERCASE_CHARS = "abcdefghijkmnopqrstuvwxyz";
const DIGIT_CHARS = "23456789";
const SPECIAL_CHARS = "!@#$%^&*()-_=+[]{}.,;:~?";
const ALL_CHARS = `${UPPERCASE_CHARS}${LOWERCASE_CHARS}${DIGIT_CHARS}${SPECIAL_CHARS}`;

function randomIndex(max: number): number {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(1);
    cryptoApi.getRandomValues(values);
    return values[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function pick(chars: string): string {
  return chars[randomIndex(chars.length)];
}

function shuffle(values: string[]): string[] {
  const next = [...values];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function generateStrongPassword(length = 12): string {
  const targetLength = Math.max(length, MIN_PASSWORD_LENGTH);
  const seed = [pick(UPPERCASE_CHARS), pick(LOWERCASE_CHARS), pick(DIGIT_CHARS), pick(SPECIAL_CHARS)];

  while (seed.length < targetLength) {
    seed.push(pick(ALL_CHARS));
  }

  return shuffle(seed).join("");
}

function RequirementRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={`flex items-start gap-2 ${ok ? "text-emerald-700" : "text-slate-500"}`}>
      <span className="mt-[1px] inline-flex h-4 w-4 items-center justify-center text-xs">{ok ? "✓" : "○"}</span>
      <span>{text}</span>
    </li>
  );
}

export default function ResetPasswordForm({ token, actionUrl }: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const policy = useMemo(
    () => evaluatePasswordPolicy(password, confirmPassword),
    [password, confirmPassword],
  );

  const handleGeneratePassword = () => {
    const generated = generateStrongPassword();
    setPassword(generated);
    setConfirmPassword(generated);
  };

  return (
    <form method="post" action={actionUrl} className="mt-6 space-y-4" autoComplete="off">
      <input type="hidden" name="token" value={token} />
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium text-slate-700">
            Neues Passwort
          </label>
          <button
            type="button"
            onClick={handleGeneratePassword}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:border-brand/60 hover:text-brand"
            title="Sicheres Passwort erzeugen"
            aria-label="Sicheres Passwort erzeugen"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
              <path
                d="M6 3.5h8a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 14 16.5H6A2.5 2.5 0 0 1 3.5 14V6A2.5 2.5 0 0 1 6 3.5Zm1.5 5h5m-5 3h5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          required
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="confirm_password" className="text-sm font-medium text-slate-700">
          Passwort wiederholen
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
          required
        />
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-sm font-semibold text-slate-700">Passwortrichtlinien</p>
        <ul className="mt-2 space-y-1 text-xs">
          <RequirementRow ok={policy.minLength} text={`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`} />
          <RequirementRow ok={policy.hasSpecial} text="Mindestens 1 Sonderzeichen" />
          <RequirementRow ok={policy.hasUppercase} text="Mindestens 1 Großbuchstabe (A-Z)" />
          <RequirementRow ok={policy.hasLowercase} text="Mindestens 1 Kleinbuchstabe (a-z)" />
          <RequirementRow ok={policy.hasDigit} text="Mindestens 1 Zahl" />
          <RequirementRow ok={policy.allowedCharsOnly} text="Nur erlaubte Zeichen (Umlaute sind nicht erlaubt)" />
          <RequirementRow ok={Boolean(policy.matchesConfirm)} text="Passwörter müssen übereinstimmen" />
        </ul>
      </div>
      <button
        type="submit"
        className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand/90"
      >
        Passwort speichern
      </button>
    </form>
  );
}

