import type { AngularComputed, AngularSignal } from './types';

export interface AngularWritableSignalLike<T> {
  (): T;
  set: (value: T) => void;
  update?: (updater: (prev: T) => T) => void;
  asReadonly?: () => () => T;
}

export interface AngularDestroyRefLike {
  onDestroy: (callback: () => void) => void;
}

export interface AngularSignalsAdapter {
  signal: <T>(initial: T) => AngularWritableSignalLike<T>;
  destroyRef?: AngularDestroyRefLike;
}

function isAngularControllerSignal(value: unknown): value is AngularSignal<unknown> {
  return (
    typeof value === 'function' &&
    'subscribe' in value &&
    typeof (value as AngularSignal<unknown>).subscribe === 'function' &&
    'set' in value &&
    typeof (value as AngularSignal<unknown>).set === 'function'
  );
}

function isAngularControllerComputed(value: unknown): value is AngularComputed<unknown> {
  return (
    typeof value === 'function' &&
    'subscribe' in value &&
    typeof (value as AngularComputed<unknown>).subscribe === 'function' &&
    !('set' in value)
  );
}

function bridgeComputedSignal<T>(
  ctrlComp: AngularComputed<T>,
  adapter: AngularSignalsAdapter,
  unsubs: Array<() => void>,
): AngularComputed<T> {
  const ngSig = adapter.signal<T>(ctrlComp());
  const unsub = ctrlComp.subscribe((next) => {
    ngSig.set(next);
  });
  unsubs.push(unsub);
  const roGetter =
    typeof ngSig.asReadonly === 'function' ? ngSig.asReadonly() : () => ngSig();
  const bridged = (() => roGetter()) as AngularComputed<T>;
  bridged.subscribe = ctrlComp.subscribe;
  return bridged;
}

function bridgeSingleSignal<T>(
  ctrlSig: AngularSignal<T>,
  adapter: AngularSignalsAdapter,
  unsubs: Array<() => void>,
): AngularSignal<T> {
  const ngSig = adapter.signal<T>(ctrlSig());
  const unsub = ctrlSig.subscribe((next) => {
    ngSig.set(next);
  });
  unsubs.push(unsub);

  const bridged = (() => ngSig()) as AngularSignal<T>;

  bridged.set = (value: T) => {
    ctrlSig.set(value);
    ngSig.set(value);
  };

  bridged.update = (updater: (prev: T) => T) => {
    const next = updater(ctrlSig());
    bridged.set(next);
  };

  bridged.subscribe = (listener: (value: T) => void) => ctrlSig.subscribe(listener);

  bridged.asReadonly = (): AngularComputed<T> => {
    const roGetter =
      typeof ngSig.asReadonly === 'function' ? ngSig.asReadonly() : () => ngSig();
    const readonlyFn = (() => roGetter()) as AngularComputed<T>;
    readonlyFn.subscribe = ctrlSig.subscribe;
    return readonlyFn;
  };

  return bridged;
}

/**
 * Bridges an `img-upload-kit/angular` controller (`createSingleUpload`, `createMultiUpload`,
 * `createImageReveal`) into Angular 17–21+'s real reactive graph (`signal()` + `DestroyRef`).
 *
 * Keeps `@angular/core` out of the library's runtime bundle while enabling native
 * `ChangeDetectionStrategy.OnPush`, `provideExperimentalZonelessChangeDetection()`,
 * `provideZonelessChangeDetection()`, `computed()`, and `effect()` reactivity.
 */
export function withAngularSignals<TController extends object>(
  controller: TController,
  adapter: AngularSignalsAdapter,
): TController {
  const unsubs: Array<() => void> = [];
  const wrapped: Record<string, unknown> = {
    ...(controller as Record<string, unknown>),
  };

  for (const [key, prop] of Object.entries(controller)) {
    if (isAngularControllerSignal(prop)) {
      wrapped[key] = bridgeSingleSignal(prop, adapter, unsubs);
    } else if (isAngularControllerComputed(prop)) {
      wrapped[key] = bridgeComputedSignal(prop, adapter, unsubs);
    }
  }

  let cleanedUp = false;
  const originalDestroy =
    typeof (controller as { destroy?: () => void }).destroy === 'function'
      ? (controller as { destroy: () => void }).destroy.bind(controller)
      : undefined;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const unsub of unsubs) {
      unsub();
    }
    unsubs.length = 0;
    originalDestroy?.();
  };

  if (originalDestroy) {
    wrapped.destroy = cleanup;
  }

  adapter.destroyRef?.onDestroy(cleanup);

  return wrapped as TController;
}
