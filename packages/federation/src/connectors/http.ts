/**
 * Minimal HTTP abstraction so connectors can be unit-tested against a mock
 * without depending on DOM/undici fetch typings. The default implementation
 * wraps the global `fetch`.
 */
export interface HttpRequestInit {
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  headerGet(name: string): string | null;
}

export type HttpClient = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

export const defaultHttpClient: HttpClient = async (url, init) => {
  const fetchFn = (globalThis as { fetch?: (...args: unknown[]) => Promise<unknown> }).fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("Global fetch is unavailable; provide an http client explicitly.");
  }
  const response = (await fetchFn(url, init as unknown)) as {
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
    text(): Promise<string>;
    headers: { get(name: string): string | null };
  };
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
    headerGet: (name) => response.headers.get(name),
  };
};
