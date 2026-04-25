import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { validateTaskSafety } from "./safety.js";
import type { OperitStore } from "./store.js";
import type { SubmitTaskInput } from "./types.js";

function asTextJson(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

const taskParamsSchema = z.record(z.string(), z.unknown()).default({});
const payloadSchema = z.record(z.string(), z.unknown()).default({});

export function createMcpServer(store: OperitStore): McpServer {
  const server = new McpServer({
    name: "operit-mcp-bridge",
    version: "0.1.0",
  });

  server.registerTool(
    "submit_operit_task",
    {
      title: "Submit Operit Task",
      description: "Submit a safe task for a specific Operit device.",
      inputSchema: {
        deviceId: z.string().min(1),
        type: z.enum(["screen_summary", "page_monitor", "tap_text", "stop"]),
        params: taskParamsSchema,
      },
    },
    async ({ deviceId, type, params }) => {
      const input: SubmitTaskInput = { deviceId, type, params };
      const safety = validateTaskSafety(input);
      const task = safety.allowed
        ? store.submitTask(input)
        : store.submitBlockedTask(input, safety.reason ?? "blocked by safety");

      return asTextJson({
        ok: safety.allowed,
        blocked: !safety.allowed,
        matchedText: safety.matchedText,
        task,
      });
    },
  );

  server.registerTool(
    "get_operit_status",
    {
      title: "Get Operit Status",
      description: "Get latest device heartbeat, current task, pending tasks, status, and recent history.",
      inputSchema: {
        deviceId: z.string().min(1),
      },
    },
    async ({ deviceId }) => asTextJson({ ok: true, device: store.getStatus(deviceId) }),
  );

  server.registerTool(
    "get_operit_screen_summary",
    {
      title: "Get Operit Screen Summary",
      description: "Ask a device to read its current UI tree/text summary.",
      inputSchema: {
        deviceId: z.string().min(1),
      },
    },
    async ({ deviceId }) => {
      const task = store.submitTask({ deviceId, type: "screen_summary", params: {} });
      return asTextJson({ ok: true, task });
    },
  );

  server.registerTool(
    "start_page_monitor",
    {
      title: "Start Page Monitor",
      description: "Start a monitor-only task that watches for target texts and stops on sensitive stop texts.",
      inputSchema: {
        deviceId: z.string().min(1),
        targetTexts: z.array(z.string()).min(1),
        stopTexts: z.array(z.string()).default(["验证码", "登录", "支付", "提交订单", "确认支付"]),
        intervalMs: z.number().int().positive().default(5000),
        maxRounds: z.number().int().positive().default(60),
        refreshMode: z.enum(["none", "swipe_down"]).default("swipe_down"),
        mode: z.enum(["monitor_only"]).default("monitor_only"),
      },
    },
    async ({ deviceId, ...params }) => {
      const task = store.submitTask({ deviceId, type: "page_monitor", params });
      return asTextJson({ ok: true, task });
    },
  );

  server.registerTool(
    "stop_operit_task",
    {
      title: "Stop Operit Task",
      description: "Ask a device to stop its current loop task.",
      inputSchema: {
        deviceId: z.string().min(1),
        taskId: z.string().optional(),
      },
    },
    async ({ deviceId, taskId }) => {
      const task = store.submitTask({ deviceId, type: "stop", params: { taskId } });
      return asTextJson({ ok: true, task });
    },
  );

  server.registerTool(
    "operit_get_next_task",
    {
      title: "Operit Get Next Task",
      description:
        "Operit-side polling tool. Returns the next task for a device and marks it running, or returns type=none.",
      inputSchema: {
        deviceId: z.string().min(1),
      },
    },
    async ({ deviceId }) => {
      const task = store.getNextTask(deviceId);
      if (!task) {
        return asTextJson({ ok: true, type: "none" });
      }

      return asTextJson({ ok: true, type: "task", task });
    },
  );

  server.registerTool(
    "operit_report_status",
    {
      title: "Operit Report Status",
      description:
        "Operit-side status reporting tool. Updates latestStatus, currentTask, device heartbeat, and task history.",
      inputSchema: {
        deviceId: z.string().min(1),
        taskId: z.string().optional(),
        status: z.enum([
          "done",
          "error",
          "found_target",
          "stopped",
          "timeout",
          "page_monitor_running",
        ]),
        message: z.string().optional(),
        payload: payloadSchema,
      },
    },
    async ({ deviceId, taskId, status, message, payload }) => {
      const report = store.reportStatus({
        deviceId,
        taskId,
        status,
        message,
        payload,
      });

      return asTextJson({ ok: true, status: report });
    },
  );

  return server;
}
