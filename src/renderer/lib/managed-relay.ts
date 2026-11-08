export const WANJUAN_MANAGED_RELAY_PLACEHOLDER = `__WANJUAN_MANAGED_RELAY__`;
export const WANJUAN_MANAGED_RELAY_API_URL = `https://jixing.guancn.uk`;
export const WANJUAN_MANAGED_RELAY_CONFIG_ID = `jixin-default`;

export type ManagedRelayRuntimeState = {
  status?: string;
  managed?: boolean;
  keyMasked?: string;
  keyVersion?: string;
};

/** Serial refreshes with a capped delay. The owner rechecks identity before each read. */
export function startManagedRelayProvisioningSync({
  isPending,
  refresh,
}: {
  isPending: () => boolean;
  refresh: () => Promise<unknown>;
}) {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const schedule = () => {
    if (stopped || !isPending()) return;
    const delay = Math.min(30_000, 1_000 * (2 ** attempt));
    attempt = Math.min(attempt + 1, 5);
    timer = globalThis.setTimeout(async () => {
      timer = undefined;
      if (stopped || !isPending()) return;
      try { await refresh(); } catch { /* Only transient polling; never expose credentials. */ }
      schedule();
    }, delay);
  };
  schedule();
  return () => {
    stopped = true;
    if (timer !== undefined) globalThis.clearTimeout(timer);
  };
}

let relayState: ManagedRelayRuntimeState | null = null;
const listeners = new Set<() => void>();

export function setManagedRelayRuntimeState(value: ManagedRelayRuntimeState | null | undefined) {
  relayState = value && typeof value === `object` ? { ...value } : null;
  listeners.forEach((listener) => listener());
}

export function getManagedRelayRuntimeState() {
  return relayState ? { ...relayState } : null;
}

export function getManagedRelayRuntimeVersion() {
  return `${relayState?.status || ``}:${relayState?.managed === true}:${relayState?.keyVersion || ``}`;
}

export function subscribeManagedRelayRuntime(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function wanjuanManagedRelayAvailable() {
  return relayState?.status === `active` && relayState?.managed === true;
}

export function wanjuanIsManagedRelayUrl(value: unknown) {
  try {
    const parsed = new URL(String(value || ``));
    return parsed.protocol === `https:`
      && parsed.hostname.toLowerCase() === `jixing.guancn.uk`
      && !parsed.username
      && !parsed.password
      && !parsed.port
      && parsed.origin === WANJUAN_MANAGED_RELAY_API_URL;
  } catch {
    return false;
  }
}

/**
 * Returns an opaque renderer marker only. The marker is never a credential;
 * Electron main replaces it for the fixed relay origin after validating account state.
 */
export function wanjuanManagedRelayPlaceholderFor(config: any = {}) {
  if (!wanjuanManagedRelayAvailable()) return ``;
  if (!wanjuanIsManagedRelayUrl(config?.url || config?.baseUrl || WANJUAN_MANAGED_RELAY_API_URL)) return ``;
  return WANJUAN_MANAGED_RELAY_PLACEHOLDER;
}

/**
 * Chooses a real saved configuration first. The managed fallback is ephemeral:
 * it is never written into project/settings data and therefore cannot overwrite
 * a user's manual provider configuration.
 */
export function wanjuanResolveManagedRelayConfig(configs: any[] = [], selectedId: unknown = ``) {
  const saved = Array.isArray(configs) ? configs.filter(Boolean) : [];
  const selected = saved.find((config) => String(config?.id || ``) === String(selectedId || ``)) || saved[0];
  if (selected) return selected;
  if (!wanjuanManagedRelayAvailable()) return undefined;
  return {
    id: WANJUAN_MANAGED_RELAY_CONFIG_ID,
    name: `极鑫托管配置`,
    url: WANJUAN_MANAGED_RELAY_API_URL,
    key: WANJUAN_MANAGED_RELAY_PLACEHOLDER,
    protocolFormat: `auto`,
    managed: true,
  };
}
