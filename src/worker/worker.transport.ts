import { buildTransports } from "../writer/factory.writer";
import { resolveSettings } from "../lib/settings.utils";
import type { LogEntry, LoggerSettings, ResolvedSettings } from "../types/logger";
import type { Transport } from "../types/transport";

type WorkerInbound =
  | { type: "init"; settings: LoggerSettings }
  | { type: "entry"; entry: LogEntry }
  | { type: "flush"; id: number }
  | { type: "close"; id: number };

type WorkerOutbound =
  | { type: "ready" }
  | { type: "acked"; id: number }
  | { type: "stats"; id: number; stats: { dropped: number; queued: number; transportErrors: number } };

let transport: Transport | null = null;

const ack = (id: number): void => {
  const message: WorkerOutbound = { id, type: "acked" };
  (globalThis as { postMessage: (message: WorkerOutbound) => void }).postMessage(message);
};

const postOut = (message: WorkerOutbound): void => {
  // Bun worker threads take postMessage(data) - no targetOrigin, unlike DOM.
  const host = globalThis as typeof globalThis & {
    postMessage: (message: WorkerOutbound) => void;
  };
  host.postMessage(message);
};

const workerSelf = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerInbound>) => void) | null;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<WorkerInbound>) => void,
  ) => void;
};

const handle = async (data: WorkerInbound): Promise<void> => {
  if (data.type === "init") {
    const settings: ResolvedSettings = resolveSettings(data.settings);
    transport = buildTransports(settings);
    postOut({ type: "ready" });
    return;
  }
  if (transport === null) return;
  if (data.type === "entry") {
    await transport.write(data.entry);
    return;
  }
  if (data.type === "flush") {
    await transport.flush?.();
    ack(data.id);
    return;
  }
  await transport.flush?.();
  await transport.close?.();
  ack(data.id);
};

workerSelf.addEventListener("message", (event: MessageEvent<WorkerInbound>): void => {
  void handle(event.data);
});
