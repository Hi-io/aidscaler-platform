import test from 'node:test';
import assert from 'node:assert/strict';
import { missingRecoveredDemoTeam } from '../src/demo-gateway.mjs';
test('only an absent fenced visitor in the same recovered world may release its demo slot', () => {
  const connection = { state: 'requires_new_response', runId: 'run', sourceInstance: 'old', observedSourceInstance: 'new' };
  const frame = { continuousDemo: true, spectatorOnly: true, runId: 'run', episodeId: 'new', organizations: [{id:'org0'}] };
  assert.equal(missingRecoveredDemoTeam('demo-org-11', connection, frame), true);
  for (const [org,c,f] of [
    ['org0',connection,frame], ['demo-org-11',{...connection,state:'connected'},frame],
    ['demo-org-11',connection,{...frame,runId:'different'}],
    ['demo-org-11',connection,{...frame,episodeId:'old'}],
    ['demo-org-11',connection,{...frame,organizations:[{id:'demo-org-11'}]}],
    ['demo-org-11',connection,{...frame,spectatorOnly:false}],
  ]) assert.equal(missingRecoveredDemoTeam(org,c,f), false);
});
