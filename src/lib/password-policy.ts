export const MIN_PASSWORD_LENGTH = 8;

// Printable ASCII without spaces (no umlauts or control chars).
const ALLOWED_PASSWORD_CHARS = /^[\x21-\x7E]+$/;
const UPPERCASE_REGEX = /[A-Z]/;
const LOWERCASE_REGEX = /[a-z]/;
const DIGIT_REGEX = /[0-9]/;
const SPECIAL_REGEX = /[^A-Za-z0-9]/;

export type PasswordPolicyEvaluation = {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasDigit: boolean;
  hasSpecial: boolean;
  allowedCharsOnly: boolean;
  matchesConfirm?: boolean;
  isValid: boolean;
};

export function evaluatePasswordPolicy(password: string, confirm?: string): PasswordPolicyEvaluation {
  const minLength = password.length >= MIN_PASSWORD_LENGTH;
  const hasUppercase = UPPERCASE_REGEX.test(password);
  const hasLowercase = LOWERCASE_REGEX.test(password);
  const hasDigit = DIGIT_REGEX.test(password);
  const hasSpecial = SPECIAL_REGEX.test(password);
  const allowedCharsOnly = password.length > 0 && ALLOWED_PASSWORD_CHARS.test(password);
  const matchesConfirm = typeof confirm === "string" ? password === confirm && password.length > 0 : undefined;

  return {
    minLength,
    hasUppercase,
    hasLowercase,
    hasDigit,
    hasSpecial,
    allowedCharsOnly,
    matchesConfirm,
    isValid:
      minLength &&
      hasUppercase &&
      hasLowercase &&
      hasDigit &&
      hasSpecial &&
      allowedCharsOnly &&
      (typeof matchesConfirm === "boolean" ? matchesConfirm : true),
  };
}

