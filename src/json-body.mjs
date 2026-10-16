import { AppError, check } from './errors.mjs';

export async function jsonBody(request, limit = 1_000_000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    check(bytes <= limit, 'BODY_LIMIT', 'Request is too large.', 413);
    chunks.push(buffer);
  }
  try {
    // Network chunks can split any UTF-8 character, including Japanese names.
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8') || '{}');
  } catch {
    throw new AppError('JSON', 'Invalid JSON.');
  }
}
