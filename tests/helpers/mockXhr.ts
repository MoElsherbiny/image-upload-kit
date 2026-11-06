/**
 * Controllable fake `XMLHttpRequest` for upload-flow tests.
 *
 * ```ts
 * const xhr = installMockXhr();
 * // ...trigger an upload in the component...
 * const req = xhr.latest();
 * req.progress(50, 100);          // upload progress event
 * req.respond(200, { url: '…' }); // JSON-serialised body
 * xhr.restore();
 * ```
 */

export interface MockProgressEvent {
  type: string;
  lengthComputable: boolean;
  loaded: number;
  total: number;
  target: unknown;
  currentTarget: unknown;
}

type Listener = (event: MockProgressEvent) => void;
type Handler = ((event: MockProgressEvent) => void) | null;

type EventType =
  | 'loadstart'
  | 'progress'
  | 'abort'
  | 'error'
  | 'load'
  | 'timeout'
  | 'loadend'
  | 'readystatechange';

export class FakeXhrEventTarget {
  onloadstart: Handler = null;
  onprogress: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  onload: Handler = null;
  ontimeout: Handler = null;
  onloadend: Handler = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Dispatches to the `on<type>` handler and every registered listener. */
  dispatch(type: EventType, init: Partial<MockProgressEvent> = {}): void {
    const event: MockProgressEvent = {
      type,
      lengthComputable: false,
      loaded: 0,
      total: 0,
      ...init,
      target: this,
      currentTarget: this,
    };
    const handler = (this as unknown as Record<string, Handler>)[`on${type}`];
    handler?.call(this, event);
    for (const listener of this.listeners.get(type) ?? []) {
      listener.call(this, event);
    }
  }
}

export class MockXMLHttpRequest extends FakeXhrEventTarget {
  static readonly UNSENT = 0;
  static readonly OPENED = 1;
  static readonly HEADERS_RECEIVED = 2;
  static readonly LOADING = 3;
  static readonly DONE = 4;

  /** Every instance created while installed, in creation order. */
  static instances: MockXMLHttpRequest[] = [];
  /** Optional hook invoked synchronously from `send()`. */
  static onSend: ((xhr: MockXMLHttpRequest) => void) | null = null;

  readonly upload = new FakeXhrEventTarget();
  onreadystatechange: Handler = null;
  readyState = 0;
  status = 0;
  statusText = '';
  responseText = '';
  response: unknown = '';
  responseType = '';
  timeout = 0;
  withCredentials = false;

  method: string | undefined;
  url: string | undefined;
  requestHeaders: Record<string, string> = {};
  responseHeaders: Record<string, string> = {};
  body: unknown;
  sent = false;
  aborted = false;

  constructor() {
    super();
    MockXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string | URL): void {
    this.method = method.toUpperCase();
    this.url = String(url);
    this.setReadyState(MockXMLHttpRequest.OPENED);
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  getResponseHeader(name: string): string | null {
    const key = Object.keys(this.responseHeaders).find(
      (header) => header.toLowerCase() === name.toLowerCase(),
    );
    return key ? this.responseHeaders[key] : null;
  }

  getAllResponseHeaders(): string {
    return Object.entries(this.responseHeaders)
      .map(([name, value]) => `${name}: ${value}`)
      .join('\r\n');
  }

  send(body?: unknown): void {
    if (this.readyState !== MockXMLHttpRequest.OPENED) {
      throw new Error('MockXMLHttpRequest: send() called before open()');
    }
    this.body = body;
    this.sent = true;
    this.dispatch('loadstart');
    this.upload.dispatch('loadstart');
    MockXMLHttpRequest.onSend?.(this);
  }

  abort(): void {
    if (this.isDone) return;
    this.aborted = true;
    this.status = 0;
    this.setReadyState(MockXMLHttpRequest.DONE);
    this.upload.dispatch('abort');
    this.upload.dispatch('loadend');
    this.dispatch('abort');
    this.dispatch('loadend');
  }

  // ---------------------------------------------------------------- controls

  get isDone(): boolean {
    return this.readyState === MockXMLHttpRequest.DONE;
  }

  /** Fires an upload `progress` event (`lengthComputable` when total > 0). */
  progress(loaded: number, total = 100): void {
    this.assertPending('progress');
    this.upload.dispatch('progress', {
      lengthComputable: total > 0,
      loaded,
      total,
    });
  }

  /** Completes the request. Non-string bodies are JSON-serialised. */
  respond(status: number, body: unknown = '', headers: Record<string, string> = {}): void {
    this.assertPending('respond');
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    this.status = status;
    this.statusText = String(status);
    this.responseHeaders = headers;
    this.responseText = text;
    this.response = text;
    this.upload.dispatch('load');
    this.upload.dispatch('loadend');
    this.setReadyState(MockXMLHttpRequest.DONE);
    this.dispatch('load');
    this.dispatch('loadend');
  }

  /** Simulates a network failure (`status` 0 + `error` event). */
  networkError(): void {
    this.assertPending('networkError');
    this.status = 0;
    this.setReadyState(MockXMLHttpRequest.DONE);
    this.upload.dispatch('error');
    this.dispatch('error');
    this.dispatch('loadend');
  }

  /** Simulates a request timeout. */
  triggerTimeout(): void {
    this.assertPending('triggerTimeout');
    this.status = 0;
    this.setReadyState(MockXMLHttpRequest.DONE);
    this.dispatch('timeout');
    this.dispatch('loadend');
  }

  private setReadyState(state: number): void {
    this.readyState = state;
    this.dispatch('readystatechange');
  }

  private assertPending(action: string): void {
    if (!this.sent) throw new Error(`MockXMLHttpRequest: ${action}() before send()`);
    if (this.isDone) throw new Error(`MockXMLHttpRequest: ${action}() after completion`);
  }
}

export interface MockXhrController {
  readonly instances: MockXMLHttpRequest[];
  /** Most recently created request (throws if none). */
  latest(): MockXMLHttpRequest;
  /** Requests that were sent and are not yet completed/aborted. */
  pending(): MockXMLHttpRequest[];
  restore(): void;
}

/** Replaces `globalThis.XMLHttpRequest` with {@link MockXMLHttpRequest}. */
export function installMockXhr(): MockXhrController {
  const scope = globalThis as { XMLHttpRequest?: unknown };
  const original = scope.XMLHttpRequest;
  MockXMLHttpRequest.instances = [];
  MockXMLHttpRequest.onSend = null;
  scope.XMLHttpRequest = MockXMLHttpRequest;

  return {
    get instances() {
      return MockXMLHttpRequest.instances;
    },
    latest() {
      const last = MockXMLHttpRequest.instances.at(-1);
      if (!last) throw new Error('No MockXMLHttpRequest has been created');
      return last;
    },
    pending() {
      return MockXMLHttpRequest.instances.filter((xhr) => xhr.sent && !xhr.isDone);
    },
    restore() {
      if (original === undefined) delete scope.XMLHttpRequest;
      else scope.XMLHttpRequest = original;
      MockXMLHttpRequest.instances = [];
      MockXMLHttpRequest.onSend = null;
    },
  };
}
