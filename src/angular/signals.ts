import type { AngularComputed, AngularSignal } from './types';

export interface SubscribableDependency {
  subscribe: (listener: () => void) => () => void;
}

/**
 * Lightweight, zero-dependency reactive signal compatible with Angular templates
 * (`{{ ctrl.isUploading() }}`), RxJS/effect bridges (`ctrl.value.subscribe(...)`),
 * and unit tests without requiring `@angular/core` at compile or runtime.
 */
export function createSignal<T>(initialValue: T): AngularSignal<T> {
  let currentValue = initialValue;
  const listeners = new Set<(value: T) => void>();

  const notify = () => {
    const snapshot = [...listeners];
    for (const listener of snapshot) {
      listener(currentValue);
    }
  };

  const signalFn = (() => currentValue) as AngularSignal<T>;

  signalFn.set = (nextValue: T) => {
    if (Object.is(currentValue, nextValue)) return;
    currentValue = nextValue;
    notify();
  };

  signalFn.update = (updater: (prev: T) => T) => {
    signalFn.set(updater(currentValue));
  };

  signalFn.subscribe = (listener: (value: T) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  signalFn.asReadonly = (): AngularComputed<T> => {
    const readonlyFn = (() => currentValue) as AngularComputed<T>;
    readonlyFn.subscribe = signalFn.subscribe;
    return readonlyFn;
  };

  return signalFn;
}

/**
 * Creates a derived read-only signal that recomputes when any dependency changes.
 */
export function createComputed<T>(
  derive: () => T,
  deps: ReadonlyArray<SubscribableDependency> = [],
): AngularComputed<T> {
  let cachedValue = derive();
  const listeners = new Set<(value: T) => void>();
  let depUnsubscribes: Array<() => void> = [];

  const recomputeAndNotify = () => {
    const nextValue = derive();
    if (Object.is(cachedValue, nextValue)) return;
    cachedValue = nextValue;
    const snapshot = [...listeners];
    for (const listener of snapshot) {
      listener(cachedValue);
    }
  };

  const ensureSubscribedToDeps = () => {
    if (depUnsubscribes.length > 0 || deps.length === 0) return;
    cachedValue = derive();
    depUnsubscribes = deps.map((dep) => dep.subscribe(recomputeAndNotify));
  };

  const cleanupDepsIfIdle = () => {
    if (listeners.size > 0 || depUnsubscribes.length === 0) return;
    for (const unsub of depUnsubscribes) {
      unsub();
    }
    depUnsubscribes = [];
  };

  const computedFn = (() => {
    cachedValue = derive();
    return cachedValue;
  }) as AngularComputed<T>;

  computedFn.subscribe = (listener: (value: T) => void): (() => void) => {
    ensureSubscribedToDeps();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      cleanupDepsIfIdle();
    };
  };

  return computedFn;
}
