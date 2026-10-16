export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export type Environment = Record<string, string | undefined>;

export async function boundedJson(response: Response, limit = 1_000_000): Promise<unknown> {
  if (!response.body) throw new ApiError(502, 'empty_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ApiError(413, 'response_too_large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => undefined); }
}
