const FOREGROUND_THREAD_REQUEST = "syndrid-desktop:foreground-thread-request";

export function requestForegroundThread(threadId: string): void {
  if (!threadId) return;
  window.dispatchEvent(
    new CustomEvent<string>(FOREGROUND_THREAD_REQUEST, { detail: threadId }),
  );
}

export function onForegroundThreadRequest(
  listener: (threadId: string) => void,
): () => void {
  const handleRequest = (event: Event) => {
    const threadId = (event as CustomEvent<unknown>).detail;
    if (typeof threadId === "string" && threadId) listener(threadId);
  };

  window.addEventListener(FOREGROUND_THREAD_REQUEST, handleRequest);
  return () => window.removeEventListener(FOREGROUND_THREAD_REQUEST, handleRequest);
}
