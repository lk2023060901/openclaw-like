import type { OutboundSendDeps } from "../infra/outbound/deliver.js";

export type CliDeps = {
  sendMessageFeishu: (params: unknown) => Promise<void>;
};

export function createDefaultDeps(): CliDeps {
  return {
    sendMessageFeishu: async () => {
      throw new Error("Feishu send not implemented in CLI deps");
    },
  };
}

export function createOutboundSendDeps(_deps: CliDeps): OutboundSendDeps {
  return {};
}

export function logWebSelfId(): void {}
