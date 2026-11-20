import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

/**
 * Node 20's bundled undici snapshots `globalThis.File` when it first loads,
 * which under vitest's jsdom environment happens after jsdom has replaced
 * `File`. Undici then builds multipart parts with jsdom's File and rejects
 * them, so in-process servers answer "No file provided".
 *
 * Loading undici here, while Node's own Blob/File are briefly restored, gives
 * it the same classes it captures in a production Node runtime.
 */
const scope = globalThis as unknown as Record<'Blob' | 'File', unknown>;
const jsdomBlob = scope.Blob;
const jsdomFile = scope.File;

scope.Blob = NodeBlob;
scope.File = NodeFile;
try {
  // First access of the lazy `Response` global loads Node's internal undici bundle.
  void new Response('').status;
} finally {
  scope.Blob = jsdomBlob;
  scope.File = jsdomFile;
}
