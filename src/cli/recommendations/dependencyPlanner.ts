import { formatInstallCommand } from '../package-managers/pmDetector';
import type { ArchitectureRecommendation, DependencyPlan } from '../types/architecture';
import type { PackageManagerName, ProjectDetectionReport } from '../types/detection';

export function planDependencies(
  report: ProjectDetectionReport,
  recommendation: ArchitectureRecommendation,
  pmOverride?: PackageManagerName,
): DependencyPlan {
  const pm = pmOverride ?? report.packageManager;
  const installed = new Set(report.installedPackages);
  const toInstall: string[] = [];
  const alreadyInstalled: string[] = [];
  const skippedServerDeps: string[] = [];
  const reasons: Record<string, string> = {};

  const consider = (pkg: string, reason: string) => {
    if (installed.has(pkg)) {
      if (!alreadyInstalled.includes(pkg)) alreadyInstalled.push(pkg);
      return;
    }
    if (!toInstall.includes(pkg)) {
      toInstall.push(pkg);
      reasons[pkg] = reason;
    }
  };

  consider('img-upload-kit', 'Core upload, optimization, and UI library');

  // Frontend peer packages
  const { frontend, runtimeCapability, storageCapability } = recommendation;
  if (frontend === 'nextjs' || frontend === 'react') {
    consider('react', 'Required peer for img-upload-kit/react');
    consider('react-dom', 'Required peer for img-upload-kit/react');
  } else if (frontend === 'vue' || frontend === 'nuxt') {
    consider('vue', 'Required peer for img-upload-kit/vue');
  } else if (frontend === 'angular') {
    consider('@angular/core', 'Required peer for img-upload-kit/angular');
  } else if (frontend === 'expo' || frontend === 'react-native') {
    if (!installed.has('expo-image-picker') && !installed.has('react-native-image-picker')) {
      consider('expo-image-picker', 'Native image picker adapter for img-upload-kit/react-native');
    }
  }

  // Server-only packages: NEVER install in frontend-only, RN/Expo, or non-Node runtimes
  const canInstallServerDeps =
    runtimeCapability.supportsSharp &&
    frontend !== 'expo' &&
    frontend !== 'react-native';

  if (canInstallServerDeps) {
    consider('sharp', `Server image optimization for ${runtimeCapability.displayName}`);
    for (const dep of storageCapability.requiredDependencies) {
      consider(dep, `Storage SDK for ${storageCapability.displayName}`);
    }
  } else {
    skippedServerDeps.push('sharp');
    for (const dep of storageCapability.requiredDependencies) {
      if (!skippedServerDeps.includes(dep)) skippedServerDeps.push(dep);
    }
  }

  return {
    pm,
    toInstall,
    alreadyInstalled,
    skippedServerDeps,
    installCommand: formatInstallCommand(pm, toInstall),
    reasons,
  };
}
