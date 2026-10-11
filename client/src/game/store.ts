import { useSyncExternalStore } from 'react';

/** Minimal observable store; React subscribes via useSyncExternalStore. */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}
  get = () => this.state;
  set(next: T) {
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  }
  patch(p: Partial<T>) {
    this.set({ ...this.state, ...p });
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
