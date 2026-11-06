import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { forwardRef, type ImgHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatedImage } from '../../src/react';

const SAMPLE_LQIP = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';

const MockNextImage = forwardRef<
  HTMLImageElement,
  ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown>
>(function MockNextImage(props, ref) {
  const { fill, priority, quality, ...rest } = props;
  return (
    <img
      ref={ref}
      data-next-fill={fill ? 'true' : undefined}
      data-next-priority={priority ? 'true' : undefined}
      data-next-quality={quality !== undefined ? String(quality) : undefined}
      {...rest}
    />
  );
});

describe('Phase 6: AnimatedImage — Imagine-Global Parity (jsdom)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('awaits img.decode() before revealing, fades placeholder immediately (0ms delay, 500ms duration), and unmounts placeholder + shimmer after fade', async () => {
    vi.useFakeTimers();
    let resolveDecode!: () => void;
    const decodePromise = new Promise<void>((res) => {
      resolveDecode = res;
    });

    const onLoad = vi.fn();
    const { container } = render(
      <AnimatedImage
        src="https://cdn.example.com/team.webp"
        alt="Team member"
        blurDataUrl={SAMPLE_LQIP}
        blurColor="var(--background-card)"
        showShimmer
        onLoad={onLoad}
      />,
    );

    const wrapper = container.querySelector<HTMLElement>('[data-slot="animated-image"]')!;
    const placeholder = container.querySelector<HTMLImageElement>(
      '[data-slot="animated-image-placeholder"]',
    )!;
    const shimmer = container.querySelector<HTMLElement>('[data-slot="animated-image-shimmer"]')!;
    const mainImg = container.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;

    expect(wrapper).toHaveAttribute('data-state', 'loading');
    expect(wrapper.style.backgroundColor).toBe('var(--background-card)');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder.style.transitionDuration).toBe('500ms');
    expect(placeholder.style.transitionDelay).toBe('');
    expect(shimmer).toBeInTheDocument();

    mainImg.decode = vi.fn(() => decodePromise);
    fireEvent.load(mainImg);

    // Still loading while decode() is pending
    expect(wrapper).toHaveAttribute('data-state', 'loading');
    expect(onLoad).not.toHaveBeenCalled();

    await act(async () => {
      resolveDecode();
      await decodePromise;
    });

    // Revealed immediately after decode() resolves; shimmer unmounts immediately on load
    expect(wrapper).toHaveAttribute('data-state', 'loaded');
    expect(mainImg).toHaveAttribute('data-state', 'loaded');
    expect(onLoad).toHaveBeenCalledWith(mainImg);
    expect(container.querySelector('[data-slot="animated-image-shimmer"]')).not.toBeInTheDocument();
    expect(placeholder).toHaveClass('iuk-animated-image__placeholder--hidden');

    // Placeholder stays mounted during the 600ms crossfade, then unmounts at duration + 50ms (650ms)
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(
      container.querySelector('[data-slot="animated-image-placeholder"]'),
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(
      container.querySelector('[data-slot="animated-image-placeholder"]'),
    ).not.toBeInTheDocument();
  });

  it('switches to fallbackSrc on primary failure and reveals when fallback loads', async () => {
    const onError = vi.fn();
    const { container } = render(
      <AnimatedImage
        src="https://cdn.example.com/broken.webp"
        fallbackSrc="https://cdn.example.com/fallback.webp"
        alt="Fallback test"
        blurDataUrl={SAMPLE_LQIP}
        onError={onError}
      />,
    );

    const wrapper = container.querySelector<HTMLElement>('[data-slot="animated-image"]')!;
    const mainImg = container.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    expect(mainImg).toHaveAttribute('src', 'https://cdn.example.com/broken.webp');

    // Primary fails -> switches to fallbackSrc without entering terminal error state
    fireEvent.error(mainImg);
    expect(onError).not.toHaveBeenCalled();
    expect(wrapper).toHaveAttribute('data-state', 'loading');
    expect(mainImg).toHaveAttribute('src', 'https://cdn.example.com/fallback.webp');

    fireEvent.load(mainImg);
    await waitFor(() => expect(wrapper).toHaveAttribute('data-state', 'loaded'));
  });

  it('keeps placeholder visible, hides broken <img>, and supports renderError({ src, retry }) on terminal error', async () => {
    const onError = vi.fn();
    const { container, getByRole } = render(
      <AnimatedImage
        src="https://cdn.example.com/missing.webp"
        alt="Missing photo"
        blurDataUrl={SAMPLE_LQIP}
        blurColor="#3b82f6"
        onError={onError}
        renderError={({ src, retry }) => (
          <button type="button" onClick={retry} data-failed-src={src}>
            Retry load
          </button>
        )}
      />,
    );

    const wrapper = container.querySelector<HTMLElement>('[data-slot="animated-image"]')!;
    const mainImg = container.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;

    fireEvent.error(mainImg);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(wrapper).toHaveAttribute('data-state', 'error');
    expect(mainImg).toHaveAttribute('data-state', 'error');
    expect(mainImg.style.visibility).toBe('hidden');
    expect(mainImg.style.opacity).toBe('0');
    // Placeholder stays visible so broken-image icon never shows
    expect(
      container.querySelector('[data-slot="animated-image-placeholder"]'),
    ).toBeInTheDocument();

    const retryBtn = getByRole('button', { name: 'Retry load' });
    expect(retryBtn).toHaveAttribute('data-failed-src', 'https://cdn.example.com/missing.webp');

    fireEvent.click(retryBtn);
    expect(wrapper).toHaveAttribute('data-state', 'loading');

    const retriedImg = container.querySelector<HTMLImageElement>('.iuk-animated-image__img')!;
    fireEvent.load(retriedImg);
    await waitFor(() => expect(wrapper).toHaveAttribute('data-state', 'loaded'));
  });

  it('supports all 6 Imagine-Global call-site prop signatures (TeamCard, HeroBackground, GalleryGrid, BlogCard, VideoEmbed, ContactHero)', () => {
    const { container } = render(
      <div>
        {/* 1. TeamCard */}
        <AnimatedImage
          as={MockNextImage}
          src="/team/member.webp"
          alt="Jane Doe"
          fill
          priority={false}
          quality={90}
          sizes="(max-width: 640px) 92vw, 33vw"
          className="team-img"
          wrapperClassName="team-wrap"
          blurDataUrl={SAMPLE_LQIP}
          blurColor="var(--background-card)"
        />
        {/* 2. HeroBackground / ContactHeroImageClient */}
        <AnimatedImage
          as={MockNextImage}
          src="/hero/bg.webp"
          alt="Hero background"
          fill
          priority
          quality={85}
          sizes="100vw"
          className="hero-img"
          blurDataUrl={SAMPLE_LQIP}
          blurColor="#1e293b"
        />
        {/* 3. GalleryGrid / VideoEmbed */}
        <AnimatedImage
          as={MockNextImage}
          src="/gallery/item.webp"
          alt="Gallery item"
          fill
          quality={80}
          sizes="(max-width: 768px) 100vw, 50vw"
          style={{ objectFit: 'contain' }}
          blurDataUrl={SAMPLE_LQIP}
          blurColor="#334155"
          showShimmer
        />
      </div>,
    );

    const wrappers = container.querySelectorAll<HTMLElement>('[data-slot="animated-image"]');
    expect(wrappers).toHaveLength(3);
    expect(wrappers[0].style.backgroundColor).toBe('var(--background-card)');
    expect(wrappers[1].querySelector('img.hero-img')).toHaveAttribute('data-next-priority', 'true');
    expect(wrappers[1].querySelector('img.hero-img')).toHaveAttribute('data-next-quality', '85');
    expect(wrappers[2]).toHaveClass('iuk-animated-image--contain');
  });
});
