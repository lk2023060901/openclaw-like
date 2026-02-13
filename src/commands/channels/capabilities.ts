import type { ChannelCapabilities, ChannelPlugin } from "../../channels/plugins/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveChannelDefaultAccountId } from "../../channels/plugins/helpers.js";
import { getChannelPlugin, listChannelPlugins } from "../../channels/plugins/index.js";
import { danger } from "../../globals.js";
import { defaultRuntime, type RuntimeEnv } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { formatChannelAccountLabel, requireValidConfig } from "./shared.js";

export type ChannelsCapabilitiesOptions = {
  channel?: string;
  account?: string;
  target?: string;
  timeout?: string;
  json?: boolean;
};

type ChannelCapabilitiesReport = {
  channel: string;
  accountId: string;
  accountName?: string;
  configured?: boolean;
  enabled?: boolean;
  support?: ChannelCapabilities;
  actions?: string[];
  probe?: unknown;
};

function formatCapabilities(cap: ChannelCapabilities | undefined): string[] {
  const lines: string[] = [];
  if (!cap) {
    return lines;
  }
  if (cap.chatTypes?.length) {
    lines.push(`Chat types: ${cap.chatTypes.join(", ")}`);
  }
  if (cap.media?.inbound?.length) {
    lines.push(`Inbound media: ${cap.media.inbound.join(", ")}`);
  }
  if (cap.media?.outbound?.length) {
    lines.push(`Outbound media: ${cap.media.outbound.join(", ")}`);
  }
  if (cap.reactions) {
    lines.push("Reactions: supported");
  }
  if (cap.typing) {
    lines.push("Typing indicators: supported");
  }
  if (cap.threads) {
    lines.push("Threads: supported");
  }
  return lines;
}

async function probeChannelCapabilities(params: {
  channel: string;
  plugin: ChannelPlugin;
  accountId: string;
  cfg: OpenClawConfig;
  runtime: RuntimeEnv;
  timeout?: number;
}): Promise<unknown> {
  return undefined;
}

export async function channelsCapabilitiesCommand(
  opts: ChannelsCapabilitiesOptions,
): Promise<void> {
  const cfg = requireValidConfig();
  const runtime = defaultRuntime();
  const channel = opts.channel ? normalizeChannelId(opts.channel) : undefined;
  const timeout = opts.timeout ? Number.parseInt(opts.timeout, 10) : undefined;

  if (channel) {
    const plugin = getChannelPlugin(channel);
    if (!plugin) {
      danger(`Channel not found: ${channel}`);
      process.exitCode = 1;
      return;
    }
    const accountId = opts.account ?? resolveChannelDefaultAccountId(cfg, channel) ?? "default";
    const report: ChannelCapabilitiesReport = {
      channel,
      accountId,
      accountName: formatChannelAccountLabel(cfg, channel, accountId),
      configured: true,
      enabled: true,
      support: plugin.capabilities,
      actions: plugin.actions?.map((a) => a.name) ?? [],
      probe: await probeChannelCapabilities({
        channel,
        plugin,
        accountId,
        cfg,
        runtime,
        timeout,
      }),
    };

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`${theme.bold(channel)} capabilities:`);
    console.log(`  Account: ${report.accountName ?? report.accountId}`);
    const capLines = formatCapabilities(report.support);
    for (const line of capLines) {
      console.log(`  ${line}`);
    }
    if (report.actions?.length) {
      console.log(`  Actions: ${report.actions.join(", ")}`);
    }
    return;
  }

  const plugins = listChannelPlugins();
  const reports: ChannelCapabilitiesReport[] = [];

  for (const plugin of plugins) {
    const ch = plugin.id;
    const accountId = resolveChannelDefaultAccountId(cfg, ch) ?? "default";
    reports.push({
      channel: ch,
      accountId,
      accountName: formatChannelAccountLabel(cfg, ch, accountId),
      configured: true,
      enabled: true,
      support: plugin.capabilities,
      actions: plugin.actions?.map((a) => a.name) ?? [],
    });
  }

  if (opts.json) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  for (const report of reports) {
    console.log(`${theme.bold(report.channel)}`);
    const capLines = formatCapabilities(report.support);
    for (const line of capLines) {
      console.log(`  ${line}`);
    }
    if (report.actions?.length) {
      console.log(`  Actions: ${report.actions.join(", ")}`);
    }
    console.log();
  }
}

function normalizeChannelId(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  return normalized || null;
}
