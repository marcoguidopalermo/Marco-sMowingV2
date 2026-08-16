// SnowMaster contract — THE TRANSCRIPTION GUARD.
//   npm test -- snowContractText
//
// The clause text in snowContractText.ts is transcribed verbatim from
// reference/Marcos_Snow_Contract_Builder.html. "Verbatim" is a claim that
// rots: someone tidies an em dash, a reference is re-exported with a reworded
// sentence, and the app quietly starts printing a different agreement from the
// one that was reviewed.
//
// So this compares the constants against the reference itself — every legal
// paragraph and every bullet, character for character after tag-stripping and
// entity decoding. It is the only test here that can fail because of something
// nobody in this repo typed.
//
// The ONE sanctioned difference is Acceptance's first sentence (the Section 1
// cross-reference fix); the test asserts that it still differs, so silently
// reverting to the reference's wording fails too.
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PROPERTY_DAMAGE, LIABILITY, ICE_CONDITIONS, DELAYS, INSURANCE_PARTS,
  TRIGGER_BULLETS, PAYMENT_BULLETS, ACCEPTANCE_PARAS,
  type Run,
} from './snowContractText';
import { DEFAULT_CGL as INSURANCE_CGL_DEFAULT } from './snowContracts';

const html = readFileSync(new URL('../../reference/Marcos_Snow_Contract_Builder.html', import.meta.url), 'utf8');

const decode = (s: string) => s
  .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&deg;/g, '°')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const flat = (runs: Run[]) => runs.map(r => (typeof r === 'string' ? r : r.b)).join('').replace(/\s+/g, ' ').trim();

// Pull one <section id="sN"> block, minus its <h2> heading.
function section(id: string): string {
  const m = html.match(new RegExp(`<section id="${id}">([\\s\\S]*?)</section>`));
  if (!m) throw new Error(`no section ${id}`);
  return m[1].replace(/<h2>[\s\S]*?<\/h2>/, '');
}
// Every <p class="legal"> in a block, in order.
const legals = (block: string) =>
  [...block.matchAll(/<p class="legal">([\s\S]*?)<\/p>/g)].map(m => strip(m[1]));
const bullets = (block: string) =>
  [...block.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => strip(m[1]));
const smalls = (block: string) =>
  [...block.matchAll(/<p class="small"[^>]*>([\s\S]*?)<\/p>/g)].map(m => strip(m[1]));

// Registers one vitest case per clause group. The comparison is unchanged from
// the standalone version — paragraph count, then each paragraph compared
// character-for-character against the reference — but a mismatch now FAILS the
// run instead of incrementing a counter, and vitest prints the character diff
// itself (which is what the hand-rolled loop below used to do by hand).
function cmp(label: string, expected: string[], got: string[]) {
  test(label, () => {
    expect(got.length, `${label}: paragraph count vs reference`).toBe(expected.length);
    expected.forEach((e, i) => {
      expect(got[i], `${label} [${i + 1}]`).toBe(e);
    });
  });
}

cmp('§7 Property Damage', legals(section('s7')), PROPERTY_DAMAGE.map(flat));
cmp('§8 Liability & Indemnity', legals(section('s8')), LIABILITY.map(flat));
cmp('§9 Ice Conditions', legals(section('s9')), ICE_CONDITIONS.map(flat));
cmp('§10 Delays & Obstructions', legals(section('s10')), DELAYS.map(flat));
cmp('§11 Insurance', legals(section('s11')),
  [`${INSURANCE_PARTS[0]}${INSURANCE_CGL_DEFAULT}${INSURANCE_PARTS[1]}`.replace(/\s+/g, ' ').trim()]);
cmp('§5 bullets', bullets(section('s5')), TRIGGER_BULLETS.map(flat));
cmp('§6 bullets', bullets(section('s6')), PAYMENT_BULLETS.map(flat));

// §13's first sentence is the ONE deliberate wording change; the rest must match.
const acc = smalls(section('s13'));
const accGot = ACCEPTANCE_PARAS.map(flat);
// Asserted as a DIFFERENCE on purpose: silently reverting to the reference's
// "the date shown in Section 1" wording must fail the run too.
test('§13 [1] Section 1 cross-reference is corrected (sanctioned deviation)', () => {
  expect(accGot[0], '§13 [1] reverted to the reference wording').not.toBe(acc[0]);
});
cmp('§13 Acceptance (rest)', acc.slice(1), accGot.slice(1));
