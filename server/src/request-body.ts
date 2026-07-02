export class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes`);
  }
}

export async function readTextBody(request: Request, limitBytes: number): Promise<string> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && Number(contentLength) > limitBytes) {
    throw new RequestBodyTooLargeError(limitBytes);
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limitBytes) {
      throw new RequestBodyTooLargeError(limitBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
