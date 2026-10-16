export const WORKSPACE_GZIP_TYPE = 'application/vnd.merhav.workspace+gzip';
export const WORKSPACE_WIRE_MAX_BYTES = 3_000_000;
export const WORKSPACE_DECODED_MAX_BYTES = 25_000_000;

export class WorkspaceTransportError extends Error {
  constructor(public readonly code: 'too_large' | 'invalid_payload' | 'unsupported_type' | 'compression_unavailable') {
    super(code); this.name = 'WorkspaceTransportError';
  }
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new WorkspaceTransportError('too_large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Application-level gzip keeps both compressed and decoded limits under our control. */
export async function encodeWorkspacePayload(json: string, compressed = true): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string; decodedBytes: number }> {
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > WORKSPACE_DECODED_MAX_BYTES) throw new WorkspaceTransportError('too_large');
  if (!compressed) {
    if (bytes.byteLength > WORKSPACE_WIRE_MAX_BYTES) throw new WorkspaceTransportError('too_large');
    return { body: bytes, contentType: 'application/json', decodedBytes: bytes.byteLength };
  }
  if (typeof CompressionStream === 'undefined') throw new WorkspaceTransportError('compression_unavailable');
  const body = await readBounded(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), WORKSPACE_WIRE_MAX_BYTES);
  return { body, contentType: WORKSPACE_GZIP_TYPE, decodedBytes: bytes.byteLength };
}

export async function decodeWorkspacePayload(body: ReadableStream<Uint8Array> | null, contentType: string, contentLength?: string | null): Promise<unknown> {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json' && type !== WORKSPACE_GZIP_TYPE) throw new WorkspaceTransportError('unsupported_type');
  if (Number(contentLength ?? 0) > WORKSPACE_WIRE_MAX_BYTES) throw new WorkspaceTransportError('too_large');
  if (!body) throw new WorkspaceTransportError('invalid_payload');
  try {
    let bytes = await readBounded(body, WORKSPACE_WIRE_MAX_BYTES);
    if (type === WORKSPACE_GZIP_TYPE) {
      if (typeof DecompressionStream === 'undefined') throw new WorkspaceTransportError('compression_unavailable');
      bytes = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), WORKSPACE_DECODED_MAX_BYTES);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof WorkspaceTransportError) throw error;
    throw new WorkspaceTransportError('invalid_payload');
  }
}
