import fs from 'node:fs/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  type AuthorizeContext, createImageUploader, createMemoryResumableSessionStore,
  createMultipartUploadHandler, createResumableUploadHandler, createUploadHttpHandler,
  type ImageUploader, type ImageUploaderOptions, type ResumableSessionStore, type UploadHttpHandlerOptions,
} from '../../src/server';
import {
  createLocalFsStorageAdapter, createMemoryStorageAdapter,
  type LocalFsStorageAdapter, type MemoryStorageAdapter, type StorageAdapter,
} from '../../src/storage';

export const LIVE_PRESIGN_SECRET = 'live-e2e-presign-secret-key-2026-ok';

export interface LiveInterceptResponse { status: number; body: unknown; headers?: Record<string, string> }
export type LiveRequestInterceptor = (
  req: IncomingMessage, url: URL,
) => LiveInterceptResponse | null | Promise<LiveInterceptResponse | null>;

export interface LiveTestServerOptions {
  defaultBucket?: string;
  uploaderOptions?: Partial<ImageUploaderOptions>;
  handlerOptions?: Partial<Omit<UploadHttpHandlerOptions, 'uploader'>>;
  resumableChunkSize?: number;
}

export interface LiveTestServer {
  readonly baseUrl: string; readonly uploadUrl: string; readonly resumableUrl: string; readonly multipartUrl: string;
  readonly tempDir: string; readonly defaultBucket: string;
  readonly localFs: LocalFsStorageAdapter; readonly storage: StorageAdapter;
  readonly multipartStorage: MemoryStorageAdapter; readonly resumableStore: ResumableSessionStore;
  readonly uploader: ImageUploader;
  setInterceptor(fn: LiveRequestInterceptor | null): void;
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

async function toWebRequest(req: IncomingMessage, baseUrl: string): Promise<Request> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((item) => headers.append(k, item));
    else if (typeof v === 'string') headers.set(k, v);
  }
  const method = (req.method ?? 'GET').toUpperCase();
  const body = method !== 'GET' && method !== 'HEAD' ? await readBody(req) : undefined;
  return new Request(new URL(req.url ?? '/', baseUrl), {
    method, headers, ...(body ? { body: new Uint8Array(body) } : {}),
  });
}

async function writeWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

export async function startLiveTestServer(options: LiveTestServerOptions = {}): Promise<LiveTestServer> {
  const defaultBucket = options.defaultBucket ?? 'media';
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'iuk-e2e-live-'));
  let interceptor: LiveRequestInterceptor | null = null;
  let dispatch: (req: IncomingMessage, res: ServerResponse) => Promise<void> = async () => {};

  const server: Server = http.createServer((req, res) => {
    void dispatch(req, res).catch((err: unknown) => {
      if (!res.headersSent) res.statusCode = 500;
      res.end(err instanceof Error ? err.message : 'Internal server error');
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const localFs = createLocalFsStorageAdapter({ rootDir: tempDir, baseUrl: `${baseUrl}/uploads` });

  const storage: StorageAdapter = {
    ...localFs,
    async createPresignedUpload({ bucket, path: objectPath, contentType }) {
      const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
      return {
        method: 'PUT',
        url: `${baseUrl}/__storage_put/${encodeURIComponent(bucket)}/${encodedPath}`,
        headers: { 'content-type': contentType },
      };
    },
  };

  const multipartStorage = createMemoryStorageAdapter({ baseUrl: `${baseUrl}/multipart-uploads` });
  const resumableStore = createMemoryResumableSessionStore();
  const uploader = createImageUploader({
    storage, defaultBucket, includeBlurHash: true, ...options.uploaderOptions,
  });

  const getSubject = ({ request }: AuthorizeContext) => request.headers.get('x-user-id') ?? undefined;
  const uploadHandler = createUploadHttpHandler({
    uploader, getSubject,
    presigned: { secret: LIVE_PRESIGN_SECRET, stagingPrefix: '_staging/' },
    allowClientOverrides: true, ...options.handlerOptions,
  });
  const resumableHandler = createResumableUploadHandler({
    uploader, store: resumableStore,
    defaultChunkSize: options.resumableChunkSize ?? 64 * 1024,
    getSubject, allowClientOverrides: true,
  });
  const multipartHandler = createMultipartUploadHandler({
    storage: multipartStorage, defaultBucket, validateOnComplete: true, getSubject,
  });

  dispatch = async (req, res) => {
    const urlObj = new URL(req.url ?? '/', baseUrl);
    const intercepted = interceptor ? await interceptor(req, urlObj) : null;
    if (intercepted) {
      res.statusCode = intercepted.status;
      res.setHeader('content-type', 'application/json');
      for (const [k, v] of Object.entries(intercepted.headers ?? {})) res.setHeader(k, v);
      res.end(typeof intercepted.body === 'string' ? intercepted.body : JSON.stringify(intercepted.body));
      return;
    }
    if (req.method === 'PUT' && urlObj.pathname.startsWith('/__storage_put/')) {
      const rest = urlObj.pathname.slice('/__storage_put/'.length);
      const slashIdx = rest.indexOf('/');
      await localFs.upload({
        bucket: decodeURIComponent(rest.slice(0, slashIdx)),
        path: rest.slice(slashIdx + 1).split('/').map(decodeURIComponent).join('/'),
        data: await readBody(req),
        contentType: String(req.headers['content-type'] ?? 'application/octet-stream'),
      });
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    const webReq = await toWebRequest(req, baseUrl);
    const m = (req.method ?? 'GET').toUpperCase();
    if (urlObj.pathname === '/api/upload') {
      return writeWebResponse(res, m === 'DELETE' ? await uploadHandler.DELETE(webReq) : await uploadHandler.POST(webReq));
    }
    if (urlObj.pathname === '/api/resumable') {
      const fn = m === 'PATCH' ? resumableHandler.PATCH : m === 'DELETE' ? resumableHandler.DELETE : resumableHandler.POST;
      return writeWebResponse(res, await fn(webReq));
    }
    if (urlObj.pathname === '/api/multipart') {
      const fn = m === 'PUT' ? multipartHandler.PUT : m === 'DELETE' ? multipartHandler.DELETE : multipartHandler.POST;
      return writeWebResponse(res, await fn(webReq));
    }
    res.statusCode = 404;
    res.end('Not found');
  };

  return {
    baseUrl,
    uploadUrl: `${baseUrl}/api/upload`,
    resumableUrl: `${baseUrl}/api/resumable`,
    multipartUrl: `${baseUrl}/api/multipart`,
    tempDir, defaultBucket, localFs, storage, multipartStorage, resumableStore, uploader,
    setInterceptor: (fn) => { interceptor = fn; },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}

interface RnFormPart { field: string; uri: string; name: string; type: string }

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsArrayBuffer(blob);
  });
}

async function encodeFetchBody(
  body: unknown, headers: Record<string, string>, rnMap: WeakMap<FormData, RnFormPart[]>,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (body instanceof FormData) {
    const boundary = `----iukLive${Math.random().toString(16).slice(2)}`;
    const chunks: Buffer[] = [];
    const pushPart = (head: string, data: Uint8Array) => {
      chunks.push(Buffer.from(`--${boundary}\r\n${head}\r\n\r\n`, 'utf8'), Buffer.from(data), Buffer.from('\r\n', 'utf8'));
    };
    for (const [k, v] of body.entries()) {
      if (typeof v === 'string') pushPart(`Content-Disposition: form-data; name="${k}"`, Buffer.from(v, 'utf8'));
      else {
        const fname = (v as File).name || 'upload.bin';
        pushPart(`Content-Disposition: form-data; name="${k}"; filename="${fname}"\r\nContent-Type: ${v.type || 'application/octet-stream'}`, await readBlobBytes(v));
      }
    }
    for (const rn of rnMap.get(body) ?? []) {
      const bytes = rn.uri.startsWith('data:')
        ? Buffer.from(rn.uri.slice(rn.uri.indexOf(',') + 1), 'base64')
        : new Uint8Array(await (await globalThis.fetch(rn.uri)).arrayBuffer());
      pushPart(`Content-Disposition: form-data; name="${rn.field}"; filename="${rn.name}"\r\nContent-Type: ${rn.type}`, bytes);
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    headers['content-type'] = `multipart/form-data; boundary=${boundary}`;
    return new Uint8Array(Buffer.concat(chunks));
  }
  if (body instanceof Blob) return new Uint8Array(Buffer.from(await readBlobBytes(body)));
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  if (typeof body === 'string') return new Uint8Array(Buffer.from(body, 'utf8'));
  return undefined;
}

/** Routes jsdom `XMLHttpRequest` (including React Native `{ uri, name, type }` FormData parts) over real `fetch`. */
export function installFetchBackedXhr(): { restore(): void } {
  const scope = globalThis as { XMLHttpRequest?: unknown };
  const originalXhr = scope.XMLHttpRequest;
  const origAppend = FormData.prototype.append as (this: FormData, name: string, value: string | Blob, filename?: string) => void;
  const rnMap = new WeakMap<FormData, RnFormPart[]>();

  FormData.prototype.append = function patchedAppend(name: string, value: unknown, filename?: string): void {
    if (value && typeof value === 'object' && !(value instanceof Blob) && typeof (value as { uri?: unknown }).uri === 'string') {
      const a = value as { uri: string; name?: string; type?: string };
      const list = rnMap.get(this) ?? [];
      list.push({ field: name, uri: a.uri, name: a.name || filename || 'upload.png', type: a.type || 'image/png' });
      rnMap.set(this, list);
      return;
    }
    if (filename !== undefined) origAppend.call(this, name, value as Blob, filename);
    else origAppend.call(this, name, value as string | Blob);
  };

  class FetchBackedXMLHttpRequest {
    upload: { onprogress: ((ev: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    status = 0;
    responseText = '';
    withCredentials = false;
    private method = 'POST';
    private url = '';
    private reqHeaders: Record<string, string> = {};
    // jsdom's AbortSignal is rejected by Node's native fetch (undici), so abort is tracked locally.
    private aborted = false;
    open(method: string, url: string | URL): void { this.method = method.toUpperCase(); this.url = String(url); }
    setRequestHeader(k: string, v: string): void { this.reqHeaders[k] = v; }
    abort(): void {
      if (this.aborted) return;
      this.aborted = true;
      this.onabort?.();
    }
    send(body?: unknown): void {
      void (async () => {
        const headers = { ...this.reqHeaders };
        const payload = await encodeFetchBody(body, headers, rnMap);
        if (this.aborted) return;
        const total = payload?.byteLength ?? 0;
        if (total > 0) this.upload.onprogress?.({ lengthComputable: true, loaded: Math.ceil(total / 2), total });
        const res = await globalThis.fetch(this.url, { method: this.method, headers, body: payload });
        const text = await res.text();
        if (this.aborted) return;
        if (total > 0) this.upload.onprogress?.({ lengthComputable: true, loaded: total, total });
        this.status = res.status;
        this.responseText = text;
        this.onload?.();
      })().catch(() => {
        if (!this.aborted) this.onerror?.();
      });
    }
  }

  scope.XMLHttpRequest = FetchBackedXMLHttpRequest;
  return {
    restore() {
      FormData.prototype.append = origAppend;
      if (originalXhr === undefined) delete scope.XMLHttpRequest;
      else scope.XMLHttpRequest = originalXhr;
    },
  };
}
