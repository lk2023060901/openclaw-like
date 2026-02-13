import * as Lark from "@larksuiteoapi/node-sdk";
import type { FeishuDomain, ResolvedFeishuAccount } from "./types.js";

// Maximum number of cached clients
const CLIENT_CACHE_MAX_SIZE = 50;

// Multi-account client cache
const clientCache = new Map<
  string,
  {
    client: Lark.Client;
    config: { appId: string; appSecret: string; domain?: FeishuDomain };
    lastAccess: number;
  }
>();

function resolveDomain(domain: FeishuDomain | undefined): Lark.Domain | string {
  if (domain === "lark") {
    return Lark.Domain.Lark;
  }
  if (domain === "feishu" || !domain) {
    return Lark.Domain.Feishu;
  }
  return domain.replace(/\/+$/, ""); // Custom URL for private deployment
}

/**
 * Evict oldest entries when cache exceeds max size.
 */
function evictOldestIfNeeded(): void {
  if (clientCache.size < CLIENT_CACHE_MAX_SIZE) {
    return;
  }

  // Find and remove the oldest entry
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [key, value] of clientCache) {
    if (value.lastAccess < oldestTime) {
      oldestTime = value.lastAccess;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    clientCache.delete(oldestKey);
  }
}

/**
 * Credentials needed to create a Feishu client.
 * Both FeishuConfig and ResolvedFeishuAccount satisfy this interface.
 */
export type FeishuClientCredentials = {
  accountId?: string;
  appId?: string;
  appSecret?: string;
  domain?: FeishuDomain;
};

/**
 * Create or get a cached Feishu client for an account.
 * Accepts any object with appId, appSecret, and optional domain/accountId.
 */
export function createFeishuClient(creds: FeishuClientCredentials): Lark.Client {
  const { accountId = "default", appId, appSecret, domain } = creds;

  if (!appId || !appSecret) {
    throw new Error(`Feishu credentials not configured for account "${accountId}"`);
  }

  // Check cache
  const cached = clientCache.get(accountId);
  if (
    cached &&
    cached.config.appId === appId &&
    cached.config.appSecret === appSecret &&
    cached.config.domain === domain
  ) {
    // Update last access time
    cached.lastAccess = Date.now();
    return cached.client;
  }

  // Evict oldest if needed
  evictOldestIfNeeded();

  // Create new client
  const client = new Lark.Client({
    appId,
    appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveDomain(domain),
  });

  // Cache it
  clientCache.set(accountId, {
    client,
    config: { appId, appSecret, domain },
    lastAccess: Date.now(),
  });

  return client;
}

/**
 * Create a Feishu WebSocket client for an account.
 * Note: WSClient is not cached since each call creates a new connection.
 */
export function createFeishuWSClient(account: ResolvedFeishuAccount): Lark.WSClient {
  const { accountId, appId, appSecret, domain } = account;

  if (!appId || !appSecret) {
    throw new Error(`Feishu credentials not configured for account "${accountId}"`);
  }

  return new Lark.WSClient({
    appId,
    appSecret,
    domain: resolveDomain(domain),
    loggerLevel: Lark.LoggerLevel.info,
  });
}

/**
 * Create an event dispatcher for an account.
 */
export function createEventDispatcher(account: ResolvedFeishuAccount): Lark.EventDispatcher {
  return new Lark.EventDispatcher({
    encryptKey: account.encryptKey,
    verificationToken: account.verificationToken,
  });
}

/**
 * Get a cached client for an account (if exists).
 */
export function getFeishuClient(accountId: string): Lark.Client | null {
  const cached = clientCache.get(accountId);
  if (cached) {
    cached.lastAccess = Date.now();
    return cached.client;
  }
  return null;
}

/**
 * Clear client cache for a specific account or all accounts.
 */
export function clearClientCache(accountId?: string): void {
  if (accountId) {
    clientCache.delete(accountId);
  } else {
    clientCache.clear();
  }
}

/**
 * Get current cache size (for monitoring/debugging).
 */
export function getClientCacheSize(): number {
  return clientCache.size;
}
