// Generated-style Cloudflare Workers & SQLite Durable Objects runtime bindings for wrangler.jsonc

declare class WebSocket {
  readonly readyState: number;
  send(message: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(attachment: unknown): void;
  deserializeAttachment(): unknown;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

declare class WebSocketRequestResponsePair {
  readonly request: string;
  readonly response: string;
  constructor(request: string, response: string);
}

interface SqlStorageCursor<T = Record<string, unknown>> {
  toArray(): T[];
}

interface SqlStorage {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlStorageCursor<T>;
}

interface DurableObjectStorage {
  readonly sql: SqlStorage;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  getAlarm(): Promise<number | null>;
  deleteAlarm(): Promise<void>;
}

interface DurableObjectState {
  readonly storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  setWebSocketAutoResponse(maybeReqResp?: WebSocketRequestResponsePair): void;
  getWebSocketAutoResponse(): WebSocketRequestResponsePair | null;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace<T = unknown> {
  readonly __brand?: T;
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ExportedHandler<E = unknown> {
  fetch?(request: Request, env: E, ctx: ExecutionContext): Response | Promise<Response>;
}

declare class Headers {
  constructor(init?: Headers | Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  has(name: string): boolean;
  delete(name: string): void;
  entries(): IterableIterator<[string, string]>;
}

interface ReadableStream<R = unknown> {
  readonly locked: boolean;
  cancel(reason?: unknown): Promise<void>;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: string | ArrayBuffer | Uint8Array | null;
}

declare class Request {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  constructor(input: string | Request, init?: RequestInit);
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: Record<string, string> | Headers;
  webSocket?: WebSocket;
}

declare class Response {
  readonly status: number;
  readonly statusText: string;
  readonly ok: boolean;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
  constructor(
    body?: ReadableStream<Uint8Array> | string | ArrayBuffer | Uint8Array | null,
    init?: ResponseInit
  );
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  static json(data: unknown, init?: ResponseInit): Response;
  static redirect(url: string, status?: number): Response;
}

declare function fetch(input: Request | string, init?: RequestInit): Promise<Response>;

declare class URLSearchParams {
  constructor(init?: string | Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  toString(): string;
}

declare class URL {
  href: string;
  readonly origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  readonly searchParams: URLSearchParams;
  constructor(url: string, base?: string);
  toString(): string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  decode(input?: ArrayBuffer | ArrayBufferView): string;
}

declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare const crypto: {
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

declare module 'cloudflare:workers' {
  export abstract class DurableObject<E = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: E;
    constructor(ctx: DurableObjectState, env: E);
    fetch?(request: Request): Response | Promise<Response>;
    webSocketMessage?(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void>;
    webSocketClose?(
      ws: WebSocket,
      code: number,
      reason: string,
      wasClean: boolean
    ): void | Promise<void>;
    webSocketError?(ws: WebSocket, error: unknown): void | Promise<void>;
    alarm?(): void | Promise<void>;
  }
}

interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  ASSETS: Fetcher;
  COOP_ROOMS: DurableObjectNamespace<import('./index').CoopRoomDurableObject>;
  ALLOWED_EXTRA_ORIGINS?: string;
  ALLOW_LOCALHOST_ORIGINS?: string;
  API_RATE_LIMITER?: RateLimitBinding;
  FEEDBACK_RATE_LIMITER?: RateLimitBinding;
  CAPYBOOP_FEEDBACK_TOKEN?: string;
  CAPYBOOP_FEEDBACK_REPO?: string;
}
