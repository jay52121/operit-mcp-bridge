import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { Request, Response } from "express";
import { validateTaskSafety } from "./safety.js";
import { MemoryOperitStore } from "./store.js";
import { createMcpServer, REGISTERED_TOOLS, SERVER_NAME } from "./tools.js";
import { TASK_TYPES, type SubmitTaskInput, type TaskType } from "./types.js";
import type { TaskStatus } from "./types.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT || 8787);
const DEVICE_ONLINE_WINDOW_MS = Number(process.env.DEVICE_ONLINE_WINDOW_MS ?? 30_000);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";

const store = new MemoryOperitStore(DEVICE_ONLINE_WINDOW_MS);
const app = createMcpExpressApp({ host: HOST });

function jsonError(res: Response, statusCode: number, error: string) {
  res.status(statusCode).json({ ok: false, error });
}

function requireBridgeToken(req: Request, res: Response, next: () => void) {
  if (!BRIDGE_TOKEN) {
    next();
    return;
  }

  const expected = `Bearer ${BRIDGE_TOKEN}`;
  if (req.header("authorization") !== expected) {
    jsonError(res, 401, "unauthorized");
    return;
  }

  next();
}

function parseSubmitTaskInput(body: unknown): SubmitTaskInput | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const deviceId = record.deviceId ?? record.device_id;
  const type = record.type ?? (record.task as Record<string, unknown> | undefined)?.type;
  const params =
    record.params ?? (record.task && typeof record.task === "object" ? record.task : undefined);

  if (typeof deviceId !== "string" || typeof type !== "string") {
    return null;
  }
  if (!TASK_TYPES.includes(type as TaskType)) {
    return null;
  }

  return {
    deviceId,
    type: type as TaskType,
    params: params && typeof params === "object" ? (params as Record<string, unknown>) : {},
  };
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "operit-mcp-bridge" });
});

app.get("/debug/mcp-info", (_req, res) => {
  res.json({
    serverName: SERVER_NAME,
    mcpEndpoint: "/mcp",
    registeredTools: REGISTERED_TOOLS,
  });
});

app.use("/api", requireBridgeToken);

app.get("/api/next-task", (req, res) => {
  const deviceId = String(req.query.device_id ?? req.query.deviceId ?? "");
  if (!deviceId) {
    jsonError(res, 400, "device_id is required");
    return;
  }

  const task = store.getNextTask(deviceId);
  if (!task) {
    res.json({ ok: true, type: "none", message: "no task" });
    return;
  }

  res.json({ ok: true, type: "task", task });
});

app.post("/api/submit-task", (req, res) => {
  const input = parseSubmitTaskInput(req.body);
  if (!input) {
    jsonError(res, 400, "invalid task input");
    return;
  }

  const safety = validateTaskSafety(input);
  const task = safety.allowed
    ? store.submitTask(input)
    : store.submitBlockedTask(input, safety.reason ?? "blocked by safety");

  res.status(safety.allowed ? 200 : 403).json({
    ok: safety.allowed,
    blocked: !safety.allowed,
    matchedText: safety.matchedText,
    task,
  });
});

app.post("/api/report-status", (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    jsonError(res, 400, "json body is required");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const deviceId = body.deviceId ?? body.device_id;
  if (typeof deviceId !== "string" || !deviceId) {
    jsonError(res, 400, "deviceId is required");
    return;
  }

  const status = typeof body.status === "string" ? body.status : "alive";
  const report = store.reportStatus({
    deviceId,
    taskId: typeof body.taskId === "string" ? body.taskId : undefined,
    status: status as never,
    message: typeof body.message === "string" ? body.message : undefined,
    taskType: typeof body.taskType === "string" ? body.taskType : undefined,
    payload: body.payload,
    screenSummary: body.screenSummary,
    error: body.error,
    details: body.details && typeof body.details === "object" ? (body.details as Record<string, unknown>) : undefined,
  });

  res.json({ ok: true, status: report });
});

app.get("/api/status", (req, res) => {
  const deviceId = String(req.query.device_id ?? req.query.deviceId ?? "");
  if (!deviceId) {
    jsonError(res, 400, "device_id is required");
    return;
  }

  res.json({ ok: true, device: store.getStatus(deviceId) });
});

app.post("/api/clear-current-task", (req, res) => {
  if (!req.body || typeof req.body !== "object") {
    jsonError(res, 400, "json body is required");
    return;
  }

  const body = req.body as Record<string, unknown>;
  const deviceId = body.deviceId ?? body.device_id;
  if (typeof deviceId !== "string" || !deviceId) {
    jsonError(res, 400, "deviceId is required");
    return;
  }

  const status = typeof body.status === "string" ? body.status : "timeout";
  const allowedStatuses = new Set([
    "done",
    "error",
    "found_target",
    "stopped",
    "timeout",
    "stopped_by_stop_text",
    "blocked_by_safety",
  ]);
  if (!allowedStatuses.has(status)) {
    jsonError(res, 400, "status must be a terminal task status");
    return;
  }

  const result = store.clearCurrentTask({
    deviceId,
    status: status as TaskStatus,
    reason: typeof body.reason === "string" ? body.reason : "manual cleanup",
  });

  res.json({ ok: true, ...result });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createMcpServer(store);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    console.error("MCP request failed", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  });
});

app.listen(PORT, HOST, () => {
  console.log(`Operit MCP bridge running at http://${HOST}:${PORT}`);
  console.log(`HTTP API: http://${HOST}:${PORT}/api`);
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
});
