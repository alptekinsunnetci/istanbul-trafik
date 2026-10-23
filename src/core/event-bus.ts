/** Minimal typed event bus. `on` returns an unsubscribe function. */
export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of [...set]) (handler as (p: Events[K]) => void)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}
