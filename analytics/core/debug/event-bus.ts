import { DebugEvent } from "./debug-event";

type Listener = (event: DebugEvent) => void;

export class DebugEventBus {
  private readonly listeners = new Set<Listener>();

  emit(event: DebugEvent): void {
    this.listeners.forEach((x) => x(event));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }
}
