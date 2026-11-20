import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

type GlobalKey = 'Blob' | 'File' | 'FormData';

/** Node fetch rejects jsdom `AbortSignal`s, so abort is raced in instead of forwarded. */
function bridgeAbortSignal(nativeFetch: typeof fetch): typeof fetch {
  return (input, init) => {
    const signal = init?.signal;
    if (!signal) return nativeFetch(input, init);
    const rest: RequestInit = { ...init };
    delete rest.signal;
    const abortError = () => new DOMException('The operation was aborted.', 'AbortError');
    if (signal.aborted) return Promise.reject(abortError());
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
      nativeFetch(input, rest).then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
    });
  };
}

/**
 * Under jsdom, Node's bundled undici multipart parser constructs parts with
 * `globalThis.File` and then brand-checks them against Node's own `File`.
 * jsdom's `File` fails that check, so `Response#formData()` throws and the
 * in-process live server answers "No file provided".
 *
 * Swapping `Blob` / `File` / `FormData` to Node's implementations makes the
 * in-process server parse uploads exactly like a production Node runtime.
 * `URL.createObjectURL` is stubbed (jsdom lacks it) so client previews never
 * fall back to jsdom's `FileReader`, which only accepts jsdom Blobs.
 * `fetch` is wrapped via `bridgeAbortSignal` for the same cross-realm reason.
 */
export async function installNodeWebGlobals(): Promise<{ restore(): void }> {
  const scope = globalThis as unknown as Record<GlobalKey, unknown>;
  const urlScope = URL as unknown as Record<'createObjectURL' | 'revokeObjectURL', unknown>;
  const saved = {
    fetch: globalThis.fetch,
    Blob: scope.Blob, File: scope.File, FormData: scope.FormData,
    createObjectURL: urlScope.createObjectURL, revokeObjectURL: urlScope.revokeObjectURL,
  };

  const probe = await new Response('probe=1', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }).formData();

  scope.Blob = NodeBlob;
  scope.File = NodeFile;
  scope.FormData = probe.constructor;
  globalThis.fetch = bridgeAbortSignal(saved.fetch);

  if (typeof saved.createObjectURL !== 'function') {
    let seq = 0;
    urlScope.createObjectURL = () => `blob:iuk-test/${(seq += 1)}`;
    urlScope.revokeObjectURL = () => undefined;
  }

  return {
    restore() {
      globalThis.fetch = saved.fetch;
      scope.Blob = saved.Blob;
      scope.File = saved.File;
      scope.FormData = saved.FormData;
      urlScope.createObjectURL = saved.createObjectURL;
      urlScope.revokeObjectURL = saved.revokeObjectURL;
    },
  };
}
