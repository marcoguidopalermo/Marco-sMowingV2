// Money in whole cents (branded), so schedules and cash-flow totals add up
// exactly. Same idea as the Renewals module's brand.ts.
declare const brand: unique symbol;
export type Cents = number & { readonly [brand]: 'Cents' };

export function cents(n: number): Cents {
  if (!Number.isInteger(n)) throw new Error(`Invalid Cents (whole cents only): ${n}`);
  return n as Cents;
}
/** From dollars, rounded to the cent. */
export const dollars = (n: number): Cents => {
  if (!Number.isFinite(n)) throw new Error(`Invalid dollar amount: ${n}`);
  return Math.round(n * 100) as Cents;
};
export const ZERO = 0 as Cents;
export const add = (...xs: number[]): Cents => xs.reduce((a, b) => a + b, 0) as Cents;
export const toDollars = (c: number): number => c / 100;

export function fmtMoney(c: number, opts: { cents?: boolean } = {}): string {
  const d = c / 100;
  const digits = opts.cents ? 2 : (Number.isInteger(d) ? 0 : 2);
  return `${d < 0 ? '−' : ''}$${Math.abs(d).toLocaleString('en-CA', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
