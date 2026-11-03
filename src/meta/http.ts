// Small fetch wrapper: JSON in, JSON out, retries on rate limits and server errors.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    url: string,
  ) {
    super(`${url} answered ${status}: ${body.slice(0, 500)}`);
    this.name = "ApiError";
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: { timeoutMs?: number; attempts?: number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
      });
      if (response.ok) return response;
      const text = await response.text();
      lastError = new ApiError(response.status, text, url);
      if (!RETRYABLE.has(response.status)) throw lastError;
    } catch (error) {
      if (error instanceof ApiError && !RETRYABLE.has(error.status)) throw error;
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  throw lastError;
}

/** Reads a server-sent event stream and yields each `data:` payload parsed as JSON. */
export async function* sseEvents<T>(response: Response): AsyncGenerator<T> {
  if (!response.body) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      yield JSON.parse(data) as T;
    }
  }
}
