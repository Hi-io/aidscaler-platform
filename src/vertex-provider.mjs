import { GoogleAuth } from 'google-auth-library';
import { randomUUID } from 'node:crypto';
import { OpenRouterProvider } from './provider.mjs';
import { check } from './errors.mjs';

const rates = {
  'gemini-3.1-flash-lite': { prompt: 0.25e-6, completion: 1.5e-6 },
  'gemini-3.8-flash': { prompt: 0.75e-6, completion: 3.75e-6 },
};
export function vertexRequest(request) {
  const names = new Map(), system = [], contents = [];
  for (const message of request.messages) {
    if (message.role === 'system') { system.push({ text: String(message.content) }); continue; }
    if (message.role === 'tool') {
      check(names.has(message.tool_call_id), 'VERTEX_TOOL', 'A tool receipt must match a model call.');
      let response; try { response = JSON.parse(message.content); } catch { response = { result: message.content }; }
      const part = { functionResponse: { name: names.get(message.tool_call_id), response: typeof response === 'object' && response !== null ? response : { result: response } } };
      const previous = contents.at(-1);
      if (previous?.role === 'user' && previous.parts.some(p => p.functionResponse)) previous.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
      continue;
    }
    const parts = [];
    for (const item of Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }]) {
      if (item.type === 'text' && item.text) parts.push({ text: item.text });
      else if (item.type === 'image_url') {
        const match = /^data:([^;]+);base64,(.+)$/.exec(item.image_url.url);
        check(match, 'VERTEX_MEDIA', 'Pass reviewed image bytes to the model.');
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      } else if (item.type !== 'text') throw Error('Unsupported Vertex media part');
    }
    for (const call of message.tool_calls ?? []) {
      names.set(call.id, call.function.name);
      parts.push({ functionCall: { name: call.function.name, args: JSON.parse(call.function.arguments) },
        ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}) });
    }
    if (parts.length) contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  return { systemInstruction: { parts: system }, contents,
    ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map(t => ({
      name: t.function.name, description: t.function.description, parametersJsonSchema: t.function.parameters })) }] } : {}),
    generationConfig: { temperature: 0.1, maxOutputTokens: request.max_tokens, thinkingConfig: { includeThoughts: false } } };
}
export function vertexResponse(data, model) {
  const candidate = data.candidates?.[0], parts = candidate?.content?.parts ?? [];
  const tool_calls = parts.filter(p => p.functionCall).map(p => ({ id: 'vertex_' + randomUUID(), type: 'function',
    function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
    ...(p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : {}) }));
  const usage = data.usageMetadata ?? {};
  return { id: data.responseId ?? randomUUID(), model, choices: candidate ? [{ finish_reason:
    candidate.finishReason === 'MAX_TOKENS' ? 'length' : tool_calls.length ? 'tool_calls' : 'stop',
    message: { role: 'assistant', content: parts.filter(p => p.text && !p.thought).map(p => p.text).join('\n') || null,
      ...(tool_calls.length ? { tool_calls } : {}) } }] : [], usage: {
    prompt_tokens: usage.promptTokenCount, completion_tokens: usage.candidatesTokenCount === undefined ? undefined :
      usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0),
    completion_tokens_details: { reasoning_tokens: usage.thoughtsTokenCount ?? 0 } } };
}
export class VertexProvider extends OpenRouterProvider {
  constructor(store, config, { auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }), fetcher = fetch } = {}) {
    const model = config.modelId;
    check(rates[model], 'VERTEX_MODEL', 'Choose a model with an explicit reviewed price schedule.');
    // Reuse durable usage, reservations, timeout handling and tool-call records.
    super(store, { ...config, apiKey: 'application-default-credentials', modelPriceMultiplier: 1 }, async (_url, init) => {
      const token = await auth.getAccessToken(), region = config.vertexLocation ?? 'global';
      const hostname = region === 'global' ? 'aiplatform.googleapis.com' : region + '-aiplatform.googleapis.com';
      const endpoint = 'https://' + hostname + '/v1/projects/' + config.vertexProject + '/locations/' + region +
        '/publishers/google/models/' + model + ':generateContent';
      const response = await fetcher(endpoint, { ...init, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(vertexRequest(JSON.parse(init.body))) });
      if (!response.ok) return response;
      return new Response(JSON.stringify(vertexResponse(await response.json(), model)), { status: 200 });
    });
  }
  async catalogue() {
    check(this.config.modelId !== 'gemini-3.8-flash' || Date.now() < Date.UTC(2027, 0, 1),
      'VERTEX_PRICING_EXPIRED', 'Review the model price schedule before resuming inference.');
    return { model: this.config.modelId, at: '2026-10-18', rates: rates[this.config.modelId],
      modalities: ['text', 'image'], parameters: ['tools', 'reasoning'], maxCompletionTokens: 32768 };
  }
}
