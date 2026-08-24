/**
 * Narrow facade for SyndridCLI's runtime-owned plugin marketplace inventory.
 * Verified against the generated v2 PluginList* / PluginSummary contracts.
 */

export interface PluginListParams {
  cwds?: string[] | null;
  marketplaceKinds?: unknown[] | null;
}

export interface PluginSummary {
  id: string;
  remotePluginId: string | null;
  version: string | null;
  localVersion: string | null;
  name: string;
  shareContext: unknown | null;
  source: unknown;
  installed: boolean;
  enabled: boolean;
  installPolicy: unknown;
  installPolicySource: unknown | null;
  authPolicy: unknown;
  availability: unknown;
  interface: unknown | null;
  keywords: string[];
}

export interface PluginMarketplaceEntry {
  name: string;
  path: string | null;
  interface: unknown | null;
  plugins: PluginSummary[];
}

export interface MarketplaceLoadErrorInfo {
  marketplaceName?: string | null;
  message?: string | null;
  [key: string]: unknown;
}

export interface PluginListResponse {
  marketplaces: PluginMarketplaceEntry[];
  marketplaceLoadErrors: MarketplaceLoadErrorInfo[];
  featuredPluginIds: string[];
}
