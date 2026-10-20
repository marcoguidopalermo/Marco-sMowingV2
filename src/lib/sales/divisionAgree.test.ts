// The server's assignee → division mapping must equal the app's capacity mapping.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { assigneeDivisionIndex as app } from '../capacity';
import { assigneeDivisionIndex as server } from '../../../functions/src/shared/divisionCore';

test('server and app agree on the assignee → division mapping', () => {
  const sch: any = {};
  const divs = ['Lawn Division', 'Small Projects', 'Large Projects'];
  for (let d = 1; d <= 60; d++) {
    const date = `2026-07-${String(((d - 1) % 28) + 1).padStart(2, '0')}`.replace('07', d > 28 ? '08' : '07');
    sch[date] = [0, 1, 2].map(i => ({ division: divs[(d + i) % 3], jobberAssigneeIds: [`U${(d * (i + 1)) % 7}`, `U${(d + i) % 5}`] }));
  }
  const settings: any = { assigneeMap: { U3: { division: 'Large Projects' } } };
  assert.deepEqual([...server(sch, settings.assigneeMap).entries()].sort(), [...app(sch, settings).entries()].sort());
});
