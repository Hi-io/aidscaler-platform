import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vertexRequest, vertexResponse } from '../src/vertex-provider.mjs';
test('Vertex tool calls preserve opaque signatures and bill thinking tokens', () => {
  const converted = vertexResponse({ candidates: [{ content: { parts: [{ thought: true, text: 'private reasoning' },
    { functionCall: { name: 'read_context', args: { kind: 'need' } }, thoughtSignature: 'opaque-signature' }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 } }, 'gemini-3.1-flash-lite');
  assert.equal(converted.usage.completion_tokens, 50);
  assert.equal(converted.choices[0].message.content, null);
  const message = converted.choices[0].message;
  const request = vertexRequest({ max_tokens: 8192, messages: [{ role: 'system', content: 'Scope' }, { role: 'user', content: 'Help' },
    message, { role: 'tool', tool_call_id: message.tool_calls[0].id, content: '{"needs":[]}' }] });
  assert.equal(request.contents[1].parts[0].thoughtSignature, 'opaque-signature');
  assert.equal(request.contents[2].parts[0].functionResponse.name, 'read_context');
  assert.equal(JSON.stringify(request).includes('private reasoning'), false);
});
