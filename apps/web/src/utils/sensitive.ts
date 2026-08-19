/**
 * Noticing personal data in a question, and saying so rather than removing it.
 *
 * The roadmap called this "PII redaction before send". Redaction is the wrong
 * shape for it, and shipping it would be worse than shipping nothing: patterns
 * catch email addresses and card numbers, and miss names, addresses, dates of
 * birth, diagnoses and everything else that actually identifies a person. A
 * product that says "PII removed" while removing a fifth of it has told the
 * person it is safe to paste the rest.
 *
 * So this notices and warns. The question still goes exactly as typed, because
 * silently altering somebody's words is its own failure — a redacted question
 * gets a worse answer and the asker never learns why. What they get instead is
 * a sentence naming what was spotted, before it leaves the browser.
 *
 * Precision is chosen over recall throughout: a warning that fires on ordinary
 * text is a warning people learn to dismiss, and a dismissed warning protects
 * nobody.
 */

export interface SensitiveFinding {
  kind: string;
  /** What to say about it, in words that suggest an action. */
  detail: string;
}

/** Digits that pass Luhn, which is what separates a card number from a number. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

const EMAIL = /\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
const CARDISH = /\b(?:\d[ -]?){13,19}\b/g;
// Deliberately narrow: an international prefix or a bracketed area code, so a
// year range or an order number does not read as a telephone number.
const PHONE = /(?:\+\d{1,3}[\s-]?\d[\d\s-]{7,}|\(\d{3}\)\s?\d{3}[\s-]?\d{4})/g;
const SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})\b/g;

export function findSensitive(text: string): SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];

  if (EMAIL.test(text)) {
    findings.push({ kind: 'email', detail: 'an email address' });
  }
  EMAIL.lastIndex = 0;

  const cards = (text.match(CARDISH) ?? []).filter((candidate) => {
    const digits = candidate.replace(/\D/g, '');
    // Luhn is what makes this precise: without it every long number — an order
    // reference, an ISBN, a timestamp — reads as a payment card.
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
  });
  if (cards.length > 0) {
    findings.push({ kind: 'card', detail: 'something that looks like a payment card number' });
  }

  if (PHONE.test(text)) {
    findings.push({ kind: 'phone', detail: 'a telephone number' });
  }
  PHONE.lastIndex = 0;

  if (SECRET.test(text)) {
    findings.push({ kind: 'secret', detail: 'what looks like an API key' });
  }
  SECRET.lastIndex = 0;

  return findings;
}

/** One sentence naming what was spotted, or nothing to say. */
export function describeSensitive(findings: readonly SensitiveFinding[]): string {
  if (findings.length === 0) return '';

  const list = findings.map((finding) => finding.detail);
  const joined =
    list.length === 1
      ? list[0]!
      : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]!}`;

  return `This question contains ${joined}. It will be sent as written, to the model this deployment is configured with.`;
}
