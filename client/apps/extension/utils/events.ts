export function onCustomEvent<T>(type: string, handler: (detail: T) => void): () => void {
  const listener = (e: Event) => {
    if (e instanceof CustomEvent) {
      handler(e.detail);
    }
  };
  document.addEventListener(type, listener);
  return () => document.removeEventListener(type, listener);
}
