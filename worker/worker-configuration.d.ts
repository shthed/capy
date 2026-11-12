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

interface Headers {
  get(name: string): string | null;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string> | Headers;
}

declare class Request {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  constructor(input: string | Request, init?: RequestInit);
}

interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  webSocket?: WebSocket;
}

declare class Response {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  constructor(body?: string | ArrayBuffer | Uint8Array | null, init?: ResponseInit);
  static json(data: unknown, init?: ResponseInit): Response;
  static redirect(url: string, status?: number): Response;
}

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

interface Env {
  ASSETS: Fetcher;
  COOP_ROOMS: DurableObjectNamespace<import('./index').CoopRoomDurableObject>;
  ALLOWED_EXTRA_ORIGINS?: string;
}
