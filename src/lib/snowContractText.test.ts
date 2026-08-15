// SnowMaster contract — THE TRANSCRIPTION GUARD.
//   npx tsx src/lib/snowContractText.test.ts
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

let bad = 0;
function cmp(label: string, expected: string[], got: string[]) {
  if (expected.length !== got.length) {
    console.log(`✗ ${label}: ${expected.length} paragraph(s) in reference, ${got.length} transcribed`);
    bad++; return;
  }
  expected.forEach((e, i) => {
    if (e === got[i]) { console.log(`✓ ${label} [${i + 1}] — ${e.length} chars`); return; }
    bad++;
    console.log(`✗ ${label} [${i + 1}] DIFFERS`);
    for (let k = 0; k < Math.max(e.length, got[i].length); k++) {
      if (e[k] !== got[i][k]) {
        console.log(`    at ${k}: reference …${JSON.stringify(e.slice(Math.max(0, k - 40), k + 40))}`);
        console.log(`            code …${JSON.stringify(got[i].slice(Math.max(0, k - 40), k + 40))}`);
        break;
      }
    }
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
console.log(acc[0] === accGot[0]
  ? '✗ §13 [1] unchanged — the Section 1 cross-reference was NOT corrected'
  : `✓ §13 [1] corrected as intended\n    was: ${acc[0]}\n    now: ${accGot[0]}`);
if (acc[0] === accGot[0]) bad++;
cmp('§13 Acceptance (rest)', acc.slice(1), accGot.slice(1));

console.log(bad === 0 ? '\nALL CLAUSES MATCH THE REFERENCE' : `\n${bad} MISMATCH(ES)`);
if (bad > 0) process.exit(1);
