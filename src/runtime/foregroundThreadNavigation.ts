export type ForegroundThreadNavigationHandler = (threadId: string) => void;

const handlers = new Set<ForegroundThreadNavigationHandler>();

export function requestForegroundThreadNavigation(threadId: string): void {
  const normalized = threadId.trim();
  if (!normalized) return;
  for (const handler of handlers) handler(normalized);
}

export function onForegroundThreadNavigation(
  handler: ForegroundThreadNavigationHandler,
): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
