import { File as NodeBufferFile } from 'node:buffer';

if (typeof globalThis.File === 'undefined') {
  const form = new FormData();
  form.append('__probe__', new Blob([]), 'probe.bin');
  const probedEntry = form.get('__probe__');
  const FileCtor =
    probedEntry && typeof probedEntry === 'object'
      ? (probedEntry.constructor as typeof File)
      : (NodeBufferFile as unknown as typeof File);
  globalThis.File = FileCtor;
}
