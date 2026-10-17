import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { ModelTasks } from '../src/cloud/model-tasks.mjs';
test('one durable model task per org, replay fenced, other organizations and operations remain independent', async t => {
  const store = await Store.open(); t.after(() => store.close());
  const queued = []; let calls = 0, release;
  const tasks = new ModelTasks({ store, enqueue: async body => queued.push(body),
    run: async () => { calls++; await new Promise(resolve => { release = resolve; }); return true; } });
  await tasks.initialize();
  assert.equal(await tasks.schedule('org-a'), true); assert.equal(await tasks.schedule('org-a'), false);
  const running = tasks.execute(queued[0]);
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await tasks.schedule('org-b'), true, 'a long model call cannot block scheduling or physical monitoring');
  assert.equal(await tasks.execute(queued[0]), false, 'duplicate delivery cannot start another investigation');
  release(); await running; assert.equal(calls, 1);
  assert.equal(await tasks.schedule('org-a'), true);
});
