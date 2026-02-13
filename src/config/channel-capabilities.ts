import type { OpenClawConfig } from "./config.js";
import { normalizeChannelId } from "../channels/plugins/index.js";
import { normalizeAccountId } from "../routing/session-key.js";

type CapabilitiesConfig = string[];

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

function normalizeCapabilities(capabilities: CapabilitiesConfig | undefined): string[] | undefined {
  if (!isStringArray(capabilities)) {
    return undefined;
  }
  const normalized = capabilities.map((entry) => entry.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveChannelCapabilities(params: {
  cfg: OpenClawConfig;
  channel: string;
  accountId?: string | null;
}): string[] | undefined {
  const channelConfig = params.cfg.channels?.[params.channel];
  if (!channelConfig) {
    return undefined;
  }
  const accountConfig =
    typeof channelConfig === "object" && channelConfig.accounts?.[params.accountId ?? "default"];
  if (accountConfig && typeof accountConfig === "object" && "capabilities" in accountConfig) {
    return normalizeCapabilities(
      (accountConfig as { capabilities?: CapabilitiesConfig }).capabilities,
    );
  }
  if (typeof channelConfig === "object" && "capabilities" in channelConfig) {
    return normalizeCapabilities(
      (channelConfig as { capabilities?: CapabilitiesConfig }).capabilities,
    );
  }
  return undefined;
}
