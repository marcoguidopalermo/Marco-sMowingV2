// Tests for the traced-driveway grid encoding.
//   npm test -- snowGrid
//
// The bug: SnowQuote held `grid: number[][]`, Firestore refuses an array inside
// an array, and every save was rejected with a 400 that nothing caught. Zero
// quotes were ever stored. Rows are strings now.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { decodeGridRows, encodeGrid, gridCellCount, gridOf } from './snowGrid';

const GRID = [[0, 1, 1], [0, 2, 1], [0, 0, 0]];
const ROWS = ['011', '021', '000'];

console.log('\nThe shape Firestore will store');
test('a grid encodes to one string per row', () => {
  assert.deepEqual(encodeGrid(GRID), ROWS);
});
test('and decodes back to exactly the same grid', () => {
  assert.deepEqual(decodeGridRows(ROWS), GRID);
  assert.deepEqual(decodeGridRows(encodeGrid(GRID)), GRID);
});
test('THE POINT: no value in the encoded form is an array', () => {
  // This is what Firestore rejected. Every element must be a scalar.
  for (const row of encodeGrid(GRID)) assert.equal(typeof row, 'string');
});
test('an empty or missing grid round-trips to empty', () => {
  assert.deepEqual(encodeGrid([]), []);
  assert.deepEqual(encodeGrid(undefined), []);
  assert.deepEqual(decodeGridRows([]), []);
  assert.deepEqual(decodeGridRows(undefined), []);
});
test('a ragged grid keeps each row its own length', () => {
  assert.deepEqual(encodeGrid([[1], [1, 2, 0]]), ['1', '120']);
});

console.log('\nRead migration — any shape a quote has ever had');
test('the string form is read', () => {
  assert.deepEqual(gridOf({ gridRows: ROWS }), GRID);
});
test('the legacy number[][] is read — a hand-repaired document still opens', () => {
  assert.deepEqual(gridOf({ grid: GRID }), GRID);
});
test('gridRows wins when somehow both are present', () => {
  assert.deepEqual(gridOf({ gridRows: ['22'], grid: [[0, 0]] }), [[2, 2]]);
});
test('neither field yields an empty grid, never a crash', () => {
  assert.deepEqual(gridOf({}), []);
  assert.deepEqual(gridOf(null), []);
  assert.deepEqual(gridOf(undefined), []);
});
test('rows of strings inside the legacy field are tolerated', () => {
  // A document repaired by hand could plausibly end up like this.
  assert.deepEqual(gridOf({ grid: ['011', '021'] as any }), [[0, 1, 1], [0, 2, 1]]);
});
test('junk characters become empty cells rather than NaN', () => {
  assert.deepEqual(decodeGridRows(['0x1']), [[0, 0, 1]]);
  assert.deepEqual(gridOf({ grid: [[null, undefined, 2]] as any }), [[0, 0, 2]]);
});

console.log('\nTraced-cell count');
test('counts only non-empty cells', () => {
  assert.equal(gridCellCount(GRID), 4);   // 1,1 · 2,1
  assert.equal(gridCellCount([]), 0);
  assert.equal(gridCellCount([[0, 0], [0, 0]]), 0);
});
