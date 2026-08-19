import { describe, expect, it } from 'vitest';
import { describeSensitive, findSensitive } from './sensitive';

/**
 * Precision over recall, deliberately. A warning that fires on ordinary text is
 * one people learn to dismiss, and a dismissed warning protects nobody.
 */
describe('what is noticed', () => {
  it('notices an email address', () => {
    expect(findSensitive('ask about dana@example.com').map((f) => f.kind)).toEqual(['email']);
  });

  it('notices a card number, by checking Luhn rather than counting digits', () => {
    // 4111 1111 1111 1111 is the canonical test number and passes Luhn.
    expect(findSensitive('card 4111 1111 1111 1111').map((f) => f.kind)).toContain('card');
  });

  it('does not call every long number a card', () => {
    // An order reference, an ISBN, a timestamp. Without Luhn each of these
    // fires, and a warning that fires on order numbers is noise.
    for (const text of ['order 1234567890123456', 'ref 9999999999999999', 'id 2026081712345678']) {
      expect(findSensitive(text).map((f) => f.kind)).not.toContain('card');
    }
  });

  it('notices a telephone number in the forms people write them', () => {
    expect(findSensitive('call +44 20 7946 0958').map((f) => f.kind)).toContain('phone');
    expect(findSensitive('call (555) 123-4567').map((f) => f.kind)).toContain('phone');
  });

  it('does not read a year range or a version as a phone number', () => {
    for (const text of ['between 2019 and 2026', 'version 1.2.3 build 4567', 'Q3 2026 figures']) {
      expect(findSensitive(text).map((f) => f.kind)).not.toContain('phone');
    }
  });

  it('notices an API key pasted into a question', () => {
    // The one most likely to be pasted by accident, and the most costly.
    expect(findSensitive('use sk-abcdefghijklmnop12345').map((f) => f.kind)).toContain('secret');
    expect(findSensitive('AKIAIOSFODNN7EXAMPLE').map((f) => f.kind)).toContain('secret');
  });

  it('says nothing about an ordinary question', () => {
    expect(findSensitive('Which suppliers are at risk this quarter?')).toEqual([]);
  });

  it('notices more than one thing at once', () => {
    const kinds = findSensitive('email dana@example.com or call +44 20 7946 0958').map((f) => f.kind);

    expect(kinds).toContain('email');
    expect(kinds).toContain('phone');
  });

  it('is repeatable, because a global regex remembers where it stopped', () => {
    // The bug this guards: a module-level /g regex keeps lastIndex between
    // calls, so the same text alternates between matching and not.
    const text = 'dana@example.com';
    expect(findSensitive(text)).toEqual(findSensitive(text));
    expect(findSensitive(text)).toEqual(findSensitive(text));
  });
});

describe('what is said', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeSensitive([])).toBe('');
  });

  it('names what was found and that the question is sent as written', () => {
    // Not "removed": the question goes exactly as typed, because silently
    // altering somebody's words gets them a worse answer without telling them
    // why.
    const message = describeSensitive(findSensitive('dana@example.com'));

    expect(message).toContain('an email address');
    expect(message).toContain('sent as written');
  });

  it('reads as a sentence with several findings', () => {
    const message = describeSensitive([
      { kind: 'a', detail: 'an email address' },
      { kind: 'b', detail: 'a telephone number' },
      { kind: 'c', detail: 'an API key' },
    ]);

    expect(message).toContain('an email address, a telephone number and an API key');
  });
});
