import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { decodeBlurHashToDataURL } from '../../blur/blurDataUtils';
import { useImageUploadContext } from '../context';
import type { CustomImageRenderer } from '../types';

export interface BlurImageProps {
  src: string;
  alt: string;
  blurDataUrl?: string | null;
  blurColor?: string | null;
  blurHash?: string | null;
  objectFit?: CSSProperties['objectFit'];
  className?: string;
  imageClassName?: string;
  style?: CSSProperties;
  renderImage?: CustomImageRenderer;
  onImageLoad?: (img: HTMLImageElement | null) => void;
}

export function BlurImage({
  src,
  alt,
  blurDataUrl,
  blurColor,
  blurHash,
  objectFit = 'cover',
  className = '',
  imageClassName = '',
  style,
  renderImage: propRenderImage,
  onImageLoad,
}: BlurImageProps) {
  const ctx = useImageUploadContext();
  const renderImage = propRenderImage || ctx.renderImage;
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const decodedHashUrl = useMemo(() => {
    if (blurDataUrl || !blurHash) return null;
    return decodeBlurHashToDataURL(blurHash, 32, 32);
  }, [blurDataUrl, blurHash]);

  const effectiveBlurUrl = blurDataUrl || decodedHashUrl || undefined;
  const isLoaded = loadedSrc === src;

  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      setLoadedSrc(src);
      onImageLoad?.(el);
    }
  }, [src, onImageLoad]);

  const imgStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit,
    opacity: isLoaded || !effectiveBlurUrl ? 1 : 0,
    transition: 'opacity 0.28s ease-out',
  };

  return (
    <div
      className={`iuk-blur-image-wrap ${className}`.trim()}
      style={{
        backgroundColor: blurColor || 'var(--iuk-placeholder-bg, #f3f4f6)',
        ...style,
      }}
    >
      {effectiveBlurUrl && (
        <div
          aria-hidden="true"
          className={`iuk-blur-image-backdrop ${isLoaded ? 'iuk-blur-image-backdrop--hidden' : ''}`}
          style={{
            backgroundImage: `url(${effectiveBlurUrl})`,
            backgroundSize: objectFit === 'contain' ? 'contain' : 'cover',
          }}
        />
      )}

      {renderImage ? (
        renderImage({
          src,
          alt,
          className: `iuk-blur-image-el ${imageClassName}`.trim(),
          style: imgStyle,
          onLoad: (el) => {
            setLoadedSrc(src);
            onImageLoad?.(el);
          },
        })
      ) : (
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={`iuk-blur-image-el ${imageClassName}`.trim()}
          style={imgStyle}
          onLoad={(e) => {
            setLoadedSrc(src);
            onImageLoad?.(e.currentTarget);
          }}
        />
      )}
    </div>
  );
}

export default BlurImage;
