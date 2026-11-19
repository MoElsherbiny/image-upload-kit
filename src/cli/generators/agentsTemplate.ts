import type { ArchitectureRecommendation, DependencyPlan } from '../types/architecture';
import type { ProjectDetectionReport } from '../types/detection';

function resolveClientImport(frontend: ArchitectureRecommendation['frontend']): string {
  if (frontend === 'vue' || frontend === 'nuxt') return 'img-upload-kit/vue';
  if (frontend === 'angular') return 'img-upload-kit/angular';
  if (frontend === 'expo' || frontend === 'react-native') return 'img-upload-kit/react-native';
  if (frontend === 'nextjs' || frontend === 'react') return 'img-upload-kit/react';
  return 'img-upload-kit/client';
}

export function buildAgentsManagedSection(
  report: ProjectDetectionReport,
  rec: ArchitectureRecommendation,
  deps: DependencyPlan,
): string {
  const clientImport = resolveClientImport(rec.frontend);
  const serverImport = rec.runtimeCapability.recommendedHandlerEntry;

  const lines: string[] = [
    '## img-upload-kit Integration Guide',
    '',
    '### Detected & Resolved Architecture',
    `- **Package Manager**: \`${deps.pm}\``,
    `- **Frontend**: \`${rec.frontend}\` (client entry: \`${clientImport}\`)`,
    `- **Backend / Runtime**: \`${rec.backend}\` (Sharp supported: \`${String(rec.runtimeCapability.supportsSharp)}\`)`,
    `- **Storage Provider**: \`${rec.storage}\` — ${rec.storageCapability.displayName} (\`${rec.storageCapability.supportLevel}\`)`,
  ];

  if (report.auth.detected !== 'none') {
    lines.push(`- **Auth**: \`${report.auth.detected}\` (wire into \`authorize\` hook)`);
  }
  if (report.monorepo.isMonorepo) {
    lines.push(`- **Monorepo**: \`${report.monorepo.tool}\``);
  }

  lines.push(
    '',
    '### Key Imports',
    `- Client/UI: \`${clientImport}\``,
    ...(serverImport !== 'none' ? [`- Server handler: \`${serverImport}\``] : []),
    '- Storage adapters: `img-upload-kit/storage`',
    '',
    '### Guardrails for AI Agents',
    '- NEVER place storage credentials or service-role keys in `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`, or `NUXT_PUBLIC_` env vars.',
    '- Always enforce authentication inside `createUploadHttpHandler({ authorize })`.',
    '- Keep `allowSvg` disabled unless SVG sanitization (`sanitizeSvg`) is explicitly required.',
  );

  if (rec.requiresCustomAdapter) {
    lines.push(
      `- **Custom Adapter Required**: \`${rec.storageCapability.displayName}\` does not have a built-in adapter; maintain the generated \`StorageAdapter\` implementation.`,
    );
  }
  if (rec.requiresSeparateProcessingBackend) {
    lines.push(
      `- **Sharp Runtime Constraint**: \`${rec.runtimeCapability.displayName}\` cannot execute Sharp native binaries. Do not install \`sharp\` in this workspace; offload image optimization to a Node.js service.`,
    );
  }

  return lines.join('\n');
}
