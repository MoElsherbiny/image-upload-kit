export interface NativeUploadTheme {
  bg: string;
  surface: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryHover: string;
  primarySoft: string;
  danger: string;
  dangerSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  placeholderBg: string;
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
}

export const defaultNativeTheme: NativeUploadTheme = {
  bg: '#ffffff',
  surface: '#f8fafc',
  surfaceHover: '#f1f5f9',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  text: '#0f172a',
  textMuted: '#64748b',
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primarySoft: 'rgba(37, 99, 235, 0.1)',
  danger: '#dc2626',
  dangerSoft: 'rgba(220, 38, 38, 0.1)',
  success: '#16a34a',
  successSoft: 'rgba(22, 163, 74, 0.1)',
  warning: '#d97706',
  warningSoft: 'rgba(217, 119, 6, 0.12)',
  info: '#0284c7',
  infoSoft: 'rgba(2, 132, 199, 0.1)',
  placeholderBg: '#f1f5f9',
  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 14,
};

export const darkNativeTheme: NativeUploadTheme = {
  bg: '#0f172a',
  surface: '#1e293b',
  surfaceHover: '#283548',
  border: '#334155',
  borderStrong: '#475569',
  text: '#f8fafc',
  textMuted: '#94a3b8',
  primary: '#3b82f6',
  primaryHover: '#60a5fa',
  primarySoft: 'rgba(59, 130, 246, 0.18)',
  danger: '#ef4444',
  dangerSoft: 'rgba(239, 68, 68, 0.18)',
  success: '#22c55e',
  successSoft: 'rgba(34, 197, 94, 0.18)',
  warning: '#f59e0b',
  warningSoft: 'rgba(245, 158, 11, 0.18)',
  info: '#38bdf8',
  infoSoft: 'rgba(56, 189, 248, 0.18)',
  placeholderBg: '#1e293b',
  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 14,
};

export const nativeThemes = {
  light: defaultNativeTheme,
  dark: darkNativeTheme,
} as const;

export function resolveNativeTheme(
  overrides?: Partial<NativeUploadTheme>,
  scheme: 'light' | 'dark' = 'light',
): NativeUploadTheme {
  const base = scheme === 'dark' ? darkNativeTheme : defaultNativeTheme;
  return overrides ? { ...base, ...overrides } : base;
}
