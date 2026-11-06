/**
 * Inline SVG icon set (24×24, stroke-based) used by the styled components.
 *
 * Replaces the former `lucide-react` dependency so consumers do not need to
 * install an icon library. Path data is derived from Lucide (ISC license,
 * https://lucide.dev/license). The prop API mirrors the subset of Lucide's
 * API the kit relied on: `size`, `strokeWidth`, `color`, `className` and any
 * other SVG attribute. Icons are decorative (`aria-hidden`) by default unless
 * an `aria-label` / `aria-labelledby` is supplied.
 */
import type { JSX, SVGProps } from 'react';

type IconTag = 'path' | 'circle';
type IconNode = ReadonlyArray<readonly [IconTag, Readonly<Record<string, string>>]>;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** Width & height in px (number) or any CSS length (string). Default 24. */
  size?: number | string;
  /** Stroke width. Default 2. */
  strokeWidth?: number | string;
  /** Stroke color. Default `currentColor`. */
  color?: string;
}

export type IconComponent = ((props: IconProps) => JSX.Element) & {
  displayName?: string;
};

function createIcon(name: string, nodes: IconNode): IconComponent {
  const Icon = ({
    size = 24,
    strokeWidth = 2,
    color = 'currentColor',
    className,
    children,
    ...rest
  }: IconProps) => {
    const labelled =
      rest['aria-label'] !== undefined || rest['aria-labelledby'] !== undefined;
    const baseClass = `iuk-icon iuk-icon--${name}`;
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className ? `${baseClass} ${className}` : baseClass}
        aria-hidden={labelled ? undefined : true}
        focusable="false"
        {...rest}
      >
        {nodes.map(([Tag, attrs], index) => (
          <Tag key={index} {...attrs} />
        ))}
        {children}
      </svg>
    );
  };
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

const p = (d: string) => ['path', { d }] as const;
const c = (cx: string, cy: string, r: string, fill?: string) => {
  const attrs: Record<string, string> = { cx, cy, r };
  if (fill) attrs.fill = fill;
  return ['circle', attrs] as const;
};

const UPLOAD_TRAY = 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4';

export const UploadIcon = createIcon('upload', [
  p('M12 3v12'),
  p('m17 8-5-5-5 5'),
  p(UPLOAD_TRAY),
]);

export const DownloadIcon = createIcon('download', [
  p('M12 15V3'),
  p(UPLOAD_TRAY),
  p('m7 10 5 5 5-5'),
]);

export const ImagePlusIcon = createIcon('image-plus', [
  p('M16 5h6'),
  p('M19 2v6'),
  p('M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5'),
  p('m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'),
  c('9', '9', '2'),
]);

export const XIcon = createIcon('x', [p('M18 6 6 18'), p('m6 6 12 12')]);

export const CheckIcon = createIcon('check', [p('M20 6 9 17l-5-5')]);

export const MinusIcon = createIcon('minus', [p('M5 12h14')]);

export const LoaderIcon = createIcon('loader', [
  p('M21 12a9 9 0 1 1-6.219-8.56'),
]);

export const ChevronUpIcon = createIcon('chevron-up', [p('m18 15-6-6-6 6')]);

export const ChevronDownIcon = createIcon('chevron-down', [p('m6 9 6 6 6-6')]);

export const AlertTriangleIcon = createIcon('alert-triangle', [
  p('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'),
  p('M12 9v4'),
  p('M12 17h.01'),
]);

export const SaveIcon = createIcon('save', [
  p(
    'M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  ),
  p('M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7'),
  p('M7 3v4a1 1 0 0 0 1 1h7'),
]);

export const EyeIcon = createIcon('eye', [
  p(
    'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
  ),
  c('12', '12', '3'),
]);

export const InfoIcon = createIcon('info', [
  c('12', '12', '10'),
  p('M12 16v-4'),
  p('M12 8h.01'),
]);

export const ZapIcon = createIcon('zap', [
  p(
    'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z',
  ),
]);

export const CheckCircleIcon = createIcon('check-circle', [
  c('12', '12', '10'),
  p('m9 12 2 2 4-4'),
]);

export const XCircleIcon = createIcon('x-circle', [
  c('12', '12', '10'),
  p('m15 9-6 6'),
  p('m9 9 6 6'),
]);

export const TypeIcon = createIcon('type', [
  p('M12 4v16'),
  p('M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2'),
  p('M9 20h6'),
]);

export const FolderOpenIcon = createIcon('folder-open', [
  p(
    'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2',
  ),
]);

export const PenToolIcon = createIcon('pen-tool', [
  p(
    'M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z',
  ),
  p(
    'm18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18',
  ),
  p('m2.3 2.3 7.286 7.286'),
  c('11', '11', '2'),
]);

export const WandIcon = createIcon('wand', [
  p(
    'm21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72',
  ),
  p('m14 7 3 3'),
  p('M5 6v4'),
  p('M19 14v4'),
  p('M10 2v2'),
  p('M7 8H3'),
  p('M21 16h-4'),
  p('M11 3H9'),
]);

export const TrashIcon = createIcon('trash', [
  p('M10 11v6'),
  p('M14 11v6'),
  p('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'),
  p('M3 6h18'),
  p('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'),
]);

export const PaletteIcon = createIcon('palette', [
  p(
    'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z',
  ),
  c('13.5', '6.5', '.5', 'currentColor'),
  c('17.5', '10.5', '.5', 'currentColor'),
  c('6.5', '12.5', '.5', 'currentColor'),
  c('8.5', '7.5', '.5', 'currentColor'),
]);
