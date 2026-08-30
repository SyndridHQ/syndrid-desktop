const RUNTIME_BINARY_KEY = "syndrid.desktop.runtimeBinary";
export const MAX_RUNTIME_BINARY_CHARS = 32_768;

export function getRuntimeBinaryOverride(): string | null {
  try {
    const value = window.localStorage.getItem(RUNTIME_BINARY_KEY)?.trim();
    if (!value || value.length > MAX_RUNTIME_BINARY_CHARS) return null;
    return value;
  } catch {
    return null;
  }
}

export function setRuntimeBinaryOverride(value: string | null): boolean {
  try {
    const normalized = value?.trim();
    if (normalized && normalized.length > MAX_RUNTIME_BINARY_CHARS) return false;
    if (normalized) {
      window.localStorage.setItem(RUNTIME_BINARY_KEY, normalized);
    } else {
      window.localStorage.removeItem(RUNTIME_BINARY_KEY);
    }
    return true;
  } catch {
    // Storage can be unavailable in constrained webviews. The runtime remains usable
    // through SYNDRID_APP_SERVER_BINARY or PATH in that case.
    return false;
  }
}
