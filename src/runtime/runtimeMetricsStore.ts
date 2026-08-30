type Listener = () => void;

const listeners = new Set<Listener>();
let notificationCount = 0;

export const runtimeMetricsStore = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getNotificationCount(): number {
    return notificationCount;
  },

  addNotifications(count = 1): void {
    if (count <= 0) return;
    notificationCount += count;
    for (const listener of listeners) listener();
  },
};
