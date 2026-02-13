import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DynamicAgentCreationConfig, GroupUserWorkspaceConfig } from "./types.js";

export type MaybeCreateDynamicAgentResult = {
  created: boolean;
  updatedCfg: OpenClawConfig;
  agentId?: string;
};

/**
 * Sanitize a string for use in file paths and agent IDs.
 * Removes or replaces characters that are not filesystem-safe.
 */
function sanitizeForPath(str: string): string {
  return str
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/\.+/g, ".")
    .slice(0, 50);
}

/**
 * Generate a friendly agent ID from user name and open ID.
 * Format: feishu-{userName}-{shortId} or feishu-{openId}
 */
function generateFriendlyAgentId(senderOpenId: string, senderName?: string): string {
  if (senderName) {
    const sanitized = sanitizeForPath(senderName);
    const shortId = senderOpenId.replace(/^(ou_|on_)/, "").slice(0, 8);
    return `feishu-${sanitized}-${shortId}`;
  }
  return `feishu-${senderOpenId}`;
}

/**
 * Check if a dynamic agent should be created for a DM user and create it if needed.
 * This creates a unique agent instance with its own workspace for each DM user.
 */
export async function maybeCreateDynamicAgent(params: {
  cfg: OpenClawConfig;
  runtime: PluginRuntime;
  senderOpenId: string;
  senderName?: string;
  dynamicCfg: DynamicAgentCreationConfig;
  log: (msg: string) => void;
}): Promise<MaybeCreateDynamicAgentResult> {
  const { cfg, runtime, senderOpenId, senderName, dynamicCfg, log } = params;

  // Check if there's already a binding for this user
  const existingBindings = cfg.bindings ?? [];
  const hasBinding = existingBindings.some(
    (b) =>
      b.match?.channel === "feishu" &&
      b.match?.peer?.kind === "direct" &&
      b.match?.peer?.id === senderOpenId,
  );

  if (hasBinding) {
    return { created: false, updatedCfg: cfg };
  }

  // Check maxAgents limit if configured
  if (dynamicCfg.maxAgents !== undefined) {
    const feishuAgentCount = (cfg.agents?.list ?? []).filter((a) =>
      a.id.startsWith("feishu-"),
    ).length;
    if (feishuAgentCount >= dynamicCfg.maxAgents) {
      log(
        `feishu: maxAgents limit (${dynamicCfg.maxAgents}) reached, not creating agent for ${senderOpenId}`,
      );
      return { created: false, updatedCfg: cfg };
    }
  }

  // Generate friendly agent ID with user name if available
  const agentId = generateFriendlyAgentId(senderOpenId, senderName);

  // Check if agent already exists (but binding was missing)
  const existingAgent = (cfg.agents?.list ?? []).find((a) => a.id === agentId);
  if (existingAgent) {
    // Agent exists but binding doesn't - just add the binding
    log(`feishu: agent "${agentId}" exists, adding missing binding for ${senderOpenId}`);

    const updatedCfg: OpenClawConfig = {
      ...cfg,
      bindings: [
        ...existingBindings,
        {
          agentId,
          match: {
            channel: "feishu",
            peer: { kind: "direct", id: senderOpenId },
          },
        },
      ],
    };

    await runtime.config.writeConfigFile(updatedCfg);
    return { created: true, updatedCfg, agentId };
  }

  // Resolve path templates with substitutions
  const workspaceTemplate = dynamicCfg.workspaceTemplate ?? "~/.openclaw/workspace-{agentId}";
  const agentDirTemplate = dynamicCfg.agentDirTemplate ?? "~/.openclaw/agents/{agentId}/agent";

  const workspace = resolveUserPath(
    workspaceTemplate.replace("{userId}", senderOpenId).replace("{agentId}", agentId),
  );
  const agentDir = resolveUserPath(
    agentDirTemplate.replace("{userId}", senderOpenId).replace("{agentId}", agentId),
  );

  log(`feishu: creating dynamic agent "${agentId}" for user ${senderOpenId}`);
  log(`  workspace: ${workspace}`);
  log(`  agentDir: ${agentDir}`);

  // Create directories
  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.mkdir(agentDir, { recursive: true });

  // Update configuration with new agent and binding
  const updatedCfg: OpenClawConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: [...(cfg.agents?.list ?? []), { id: agentId, workspace, agentDir }],
    },
    bindings: [
      ...existingBindings,
      {
        agentId,
        match: {
          channel: "feishu",
          peer: { kind: "direct", id: senderOpenId },
        },
      },
    ],
  };

  // Write updated config using PluginRuntime API
  await runtime.config.writeConfigFile(updatedCfg);

  return { created: true, updatedCfg, agentId };
}

/**
 * Resolve a path that may start with ~ to the user's home directory.
 */
function resolveUserPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export type MaybeCreateGroupUserAgentResult = {
  created: boolean;
  updatedCfg: OpenClawConfig;
  agentId?: string;
};

/**
 * Check if a dynamic agent should be created for a group user and create it if needed.
 * This creates a unique agent instance with its own workspace for each user in group chats,
 * preventing task interference between different users.
 *
 * Mode:
 * - "per-user": Each user gets a unique workspace across all groups (agentId: feishu-user-{senderOpenId})
 * - "per-session": Each user gets a unique workspace per group (agentId: feishu-session-{chatId}-{senderOpenId})
 */
export async function maybeCreateGroupUserAgent(params: {
  cfg: OpenClawConfig;
  runtime: PluginRuntime;
  chatId: string;
  senderOpenId: string;
  groupUserWorkspaceCfg: GroupUserWorkspaceConfig;
  log: (msg: string) => void;
}): Promise<MaybeCreateGroupUserAgentResult> {
  const { cfg, runtime, chatId, senderOpenId, groupUserWorkspaceCfg, log } = params;

  const mode = groupUserWorkspaceCfg.mode ?? "per-session";

  const agentId =
    mode === "per-user"
      ? `feishu-user-${senderOpenId}`
      : `feishu-session-${chatId}-${senderOpenId}`;

  const peerId = mode === "per-user" ? senderOpenId : `${chatId}:${senderOpenId}`;

  const existingBindings = cfg.bindings ?? [];
  const hasBinding = existingBindings.some(
    (b) =>
      b.match?.channel === "feishu" &&
      b.match?.peer?.kind === "group" &&
      b.match?.peer?.id === peerId,
  );

  if (hasBinding) {
    return { created: false, updatedCfg: cfg, agentId };
  }

  if (groupUserWorkspaceCfg.maxAgents !== undefined) {
    const feishuGroupAgentCount = (cfg.agents?.list ?? []).filter(
      (a) => a.id.startsWith("feishu-user-") || a.id.startsWith("feishu-session-"),
    ).length;
    if (feishuGroupAgentCount >= groupUserWorkspaceCfg.maxAgents) {
      log(
        `feishu: maxAgents limit (${groupUserWorkspaceCfg.maxAgents}) reached, not creating group agent for ${senderOpenId}`,
      );
      return { created: false, updatedCfg: cfg };
    }
  }

  const existingAgent = (cfg.agents?.list ?? []).find((a) => a.id === agentId);
  if (existingAgent) {
    log(`feishu: group agent "${agentId}" exists, adding missing binding for ${peerId}`);

    const updatedCfg: OpenClawConfig = {
      ...cfg,
      bindings: [
        ...existingBindings,
        {
          agentId,
          match: {
            channel: "feishu",
            peer: { kind: "group", id: peerId },
          },
        },
      ],
    };

    await runtime.config.writeConfigFile(updatedCfg);
    return { created: true, updatedCfg, agentId };
  }

  const workspaceTemplate =
    groupUserWorkspaceCfg.workspaceTemplate ?? "~/.openclaw/workspace-{agentId}";
  const agentDirTemplate =
    groupUserWorkspaceCfg.agentDirTemplate ?? "~/.openclaw/agents/{agentId}/agent";

  const workspace = resolveUserPath(
    workspaceTemplate
      .replace("{chatId}", chatId)
      .replace("{userId}", senderOpenId)
      .replace("{agentId}", agentId),
  );
  const agentDir = resolveUserPath(
    agentDirTemplate
      .replace("{chatId}", chatId)
      .replace("{userId}", senderOpenId)
      .replace("{agentId}", agentId),
  );

  log(`feishu: creating group user agent "${agentId}" for user ${senderOpenId} in group ${chatId}`);
  log(`  mode: ${mode}`);
  log(`  workspace: ${workspace}`);
  log(`  agentDir: ${agentDir}`);

  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.mkdir(agentDir, { recursive: true });

  const updatedCfg: OpenClawConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      list: [...(cfg.agents?.list ?? []), { id: agentId, workspace, agentDir }],
    },
    bindings: [
      ...existingBindings,
      {
        agentId,
        match: {
          channel: "feishu",
          peer: { kind: "group", id: peerId },
        },
      },
    ],
  };

  await runtime.config.writeConfigFile(updatedCfg);

  return { created: true, updatedCfg, agentId };
}
