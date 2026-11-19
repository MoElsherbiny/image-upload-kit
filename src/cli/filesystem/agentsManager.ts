import fs from 'node:fs/promises';
import path from 'node:path';
import { detectEol, normalizeEol } from './fileManager';

export const AGENTS_MARKER_START = '<!-- img-upload-kit:start -->';
export const AGENTS_MARKER_END = '<!-- img-upload-kit:end -->';

export interface AgentsMergeResult {
  relativePath: string;
  existed: boolean;
  hadMarkers: boolean;
  changed: boolean;
  content: string;
}

export function mergeAgentsMarkdown(
  existingContent: string | null,
  managedSectionBody: string,
): { content: string; hadMarkers: boolean; changed: boolean } {
  const eol = existingContent ? detectEol(existingContent) : '\n';
  const wrappedBlock = `${AGENTS_MARKER_START}\n${managedSectionBody.trim()}\n${AGENTS_MARKER_END}`;

  if (existingContent === null || existingContent.trim().length === 0) {
    const fresh = `# AGENTS.md\n\n${wrappedBlock}\n`;
    return {
      content: normalizeEol(fresh, eol),
      hadMarkers: false,
      changed: true,
    };
  }

  const lf = existingContent.replace(/\r\n/g, '\n');
  const startIdx = lf.indexOf(AGENTS_MARKER_START);
  const endIdx = lf.indexOf(AGENTS_MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = lf.slice(0, startIdx);
    const after = lf.slice(endIdx + AGENTS_MARKER_END.length);
    const nextLf = `${before}${wrappedBlock}${after}`;
    const normalized = normalizeEol(nextLf, eol);
    return {
      content: normalized,
      hadMarkers: true,
      changed: normalized !== existingContent,
    };
  }

  const trimmedBase = lf.replace(/\n*$/, '');
  const appended = `${trimmedBase}\n\n${wrappedBlock}\n`;
  const normalized = normalizeEol(appended, eol);
  return {
    content: normalized,
    hadMarkers: false,
    changed: normalized !== existingContent,
  };
}

export async function planAgentsMdUpdate(
  cwd: string,
  managedSectionBody: string,
): Promise<AgentsMergeResult> {
  const filePath = path.join(cwd, 'AGENTS.md');
  let existing: string | null = null;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch {
    existing = null;
  }

  const merged = mergeAgentsMarkdown(existing, managedSectionBody);
  return {
    relativePath: 'AGENTS.md',
    existed: existing !== null,
    hadMarkers: merged.hadMarkers,
    changed: merged.changed,
    content: merged.content,
  };
}
