import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  foldDiacritics,
  nameTokens,
  normalizeText,
  sha256Hex,
  shortFormCandidates,
  textFingerprint,
} from '../src/names';

describe('normalizeText', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeText("Linus Torvalds, Ph.D.")).toBe('linus torvalds ph d');
  });

  it('collapses repeated whitespace', () => {
    expect(normalizeText('  Ada   Lovelace  ')).toBe('ada lovelace');
  });

  it('returns an empty string for punctuation-only input', () => {
    expect(normalizeText('!!! ---')).toBe('');
  });
});

describe('foldDiacritics', () => {
  it('removes combining marks but keeps the base letters', () => {
    expect(foldDiacritics('José')).toBe('Jose');
    expect(foldDiacritics('Ångström')).toBe('Angstrom');
  });

  it('leaves characters without diacritics alone', () => {
    expect(foldDiacritics('Ada Lovelace')).toBe('Ada Lovelace');
  });
});

describe('nameTokens', () => {
  it('separates substantive tokens from particles', () => {
    const tokens = nameTokens('Ludwig van Beethoven');
    expect(tokens.substantive).toContain('ludwig');
    expect(tokens.substantive).toContain('beethoven');
    expect(tokens.substantive).not.toContain('van');
  });

  it('produces comparable tokens for reordered names', () => {
    const a = nameTokens('Linus Torvalds');
    const b = nameTokens('Torvalds, Linus');
    expect(a.substantive.slice().sort()).toEqual(b.substantive.slice().sort());
  });

  it('exposes a leading and trailing form for comparison', () => {
    const tokens = nameTokens('Ada Byron Lovelace');
    expect(tokens.substantive[0]).toBe('ada');
    expect(tokens.substantive[tokens.substantive.length - 1]).toBe('lovelace');
  });
});

describe('shortFormCandidates', () => {
  it('maps a nickname to the full names it could stand for', () => {
    expect(shortFormCandidates('ben')).toContain('benjamin');
    expect(shortFormCandidates('mike')).toContain('michael');
  });

  it('is case-insensitive', () => {
    expect(shortFormCandidates('BEN')).toEqual(shortFormCandidates('ben'));
  });

  it('returns nothing for a token with no known short form', () => {
    expect(shortFormCandidates('zorblatt')).toEqual([]);
  });
});

describe('canonicalizeUrl', () => {
  it('adds a scheme when one is missing', () => {
    const result = canonicalizeUrl('example.com/ada');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.protocol).toBe('https:');
  });

  it('strips tracking parameters and fragments', () => {
    const result = canonicalizeUrl('https://Example.com/ada?utm_source=x&fbclid=y#bio');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.canonical).toBe('https://example.com/ada');
  });

  it('lowercases the host but preserves the path case', () => {
    const result = canonicalizeUrl('https://EXAMPLE.com/Ada/Lovelace');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.canonical).toBe('https://example.com/Ada/Lovelace');
  });

  it('rejects empty input', () => {
    expect(canonicalizeUrl('').ok).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('matches published test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('handles input spanning multiple blocks', () => {
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('accepts bytes as well as strings', () => {
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(sha256Hex('abc'));
  });
});

describe('textFingerprint', () => {
  it('is stable for identical text', () => {
    expect(textFingerprint('Software engineer')).toEqual(textFingerprint('Software engineer'));
  });

  it('differs for different text', () => {
    expect(textFingerprint('Software engineer')).not.toEqual(textFingerprint('Mechanical engineer'));
  });

  it('treats case and spacing as insignificant', () => {
    expect(textFingerprint('  Software   Engineer ')).toEqual(textFingerprint('software engineer'));
  });
});