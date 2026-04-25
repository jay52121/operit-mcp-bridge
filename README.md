# Operit MCP Bridge

Formal MVP bridge for ChatGPT and an Android Operit Worker.

ChatGPT talks to this bridge through MCP tools. The phone-side Operit Worker polls the same bridge over HTTP, executes safe local tasks, and reports status back.

## Current MVP Scope

- Public HTTPS MCP endpoint for ChatGPT-compatible MCP clients.
- HTTP polling API for Operit Worker.
- In-memory task and status store.
- Device heartbeat with 30 second online window.
- Separate `pendingTasks`, `currentTask`, `latestStatus`, and `taskHistory`.
- Recent task history keeps the latest 50 terminal tasks per device.
- No local model dependency in v1.
- Safety filtering for dangerous `tap_text` tasks on both Bridge and Worker.

## Architecture

```text
User
  -> ChatGPT
  -> MCP tools
  -> HTTPS Bridge
  -> HTTP polling API
  -> Operit Worker on Android
  -> UI Tree / accessibility actions
  -> report status back to Bridge
```

Codex Web, Codex CLI, and this Windows PC are not the final server. They are only for development and testing.

## Install

```powershell
cd "C:\Users\YZ\Documents\New project\operit-mcp-bridge"
npm install
```

## Run Locally

```powershell
npm run dev
```

Default local endpoints:

```text
HTTP API: http://127.0.0.1:8787/api
MCP endpoint: http://127.0.0.1:8787/mcp
```

When binding to `0.0.0.0`, use your PC LAN IP from `ipconfig` for local phone testing. Do not use a local LAN IP for hosted deployment.

## Production Mode Locally

Build and run the same entrypoint that Koyeb, Render, or a VPS should use:

```powershell
npm run build
npm start
```

Health check:

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/health"
```

MCP debug info:

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/debug/mcp-info"
```

If `BRIDGE_TOKEN` is set, HTTP API routes under `/api/*` require:

```text
Authorization: Bearer <token>
```

`/health` does not require a token so cloud platforms can run health checks.

## HTTP API

### Submit Task

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/submit-task" -Method POST -ContentType "application/json" -Body '{
  "deviceId": "phone1",
  "type": "screen_summary",
  "params": {}
}'
```

### Phone Polls Next Task

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/next-task?device_id=phone1"
```

Important: polling does not delete the task. It marks a pending task as `running` and stores it in `currentTask`. Only terminal reports move it to `taskHistory`.

### Report Status

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/report-status" -Method POST -ContentType "application/json" -Body '{
  "deviceId": "phone1",
  "taskId": "replace-with-task-id",
  "status": "done",
  "message": "screen summary captured",
  "screenSummary": {
    "texts": ["首页", "个人中心"]
  }
}'
```

### Query Status

```powershell
Invoke-RestMethod "http://127.0.0.1:8787/api/status?device_id=phone1"
```

The response includes:

- `online`: true when `lastSeenAt` is within 30 seconds.
- `latestStatus`
- `currentTask`
- `pendingTasks`
- `taskHistory`

## MCP Tools

MCP endpoint:

```text
POST /mcp
```

Tools:

- `submit_operit_task`
- `get_operit_status`
- `get_operit_screen_summary`
- `start_page_monitor`
- `stop_operit_task`
- `operit_get_next_task`
- `operit_report_status`

### Operit As MCP Client

Operit can connect to this Bridge as a remote MCP client and use the Operit-side tools instead of the HTTP polling API.

Remote MCP URL:

```text
http://127.0.0.1:8787/mcp
```

For phone testing on the same LAN, use the computer IP:

```text
http://<YOUR_PC_LAN_IP>:8787/mcp
```

For real ChatGPT or remote-phone use, expose the Bridge through a public HTTPS endpoint:

```text
https://your-bridge.example.com/mcp
```

Operit-side tools:

- `operit_get_next_task`: input `{ "deviceId": "phone1" }`; returns `{ "ok": true, "type": "none" }` or `{ "ok": true, "type": "task", "task": ... }` and marks the task `running`.
- `operit_report_status`: input `{ "deviceId": "phone1", "taskId": "...", "status": "done", "payload": {} }`; updates `latestStatus`, `currentTask`, heartbeat, and task history.

Real ChatGPT integration needs a public HTTPS MCP endpoint. Local development can use a tunnel. Formal use should deploy this bridge to a persistent HTTPS service such as Render, Railway, Fly.io, or a VPS.

If your current ChatGPT entry point does not support custom MCP servers, test through the HTTP API, Codex, or scripts first.

## Deploy To Koyeb

This project is ready to run as a Koyeb Node.js Web Service.

Koyeb should use:

```text
Build command: npm run build
Run command: npm start
Health check path: /health
```

The server reads the port from Koyeb:

```ts
const PORT = Number(process.env.PORT || 8787);
```

No local IP is required in the service. Koyeb provides the public HTTPS URL after deployment.

After deploy, use:

```text
HTTPS base URL: https://<your-koyeb-app>.koyeb.app
MCP endpoint: https://<your-koyeb-app>.koyeb.app/mcp
HTTP API: https://<your-koyeb-app>.koyeb.app/api
Health: https://<your-koyeb-app>.koyeb.app/health
```

Operit should connect to the Koyeb HTTPS MCP endpoint:

```text
https://<your-koyeb-app>.koyeb.app/mcp
```

For manual API testing after deployment:

```powershell
Invoke-RestMethod "https://<your-koyeb-app>.koyeb.app/health"
```

## Cloud Deployment Checklist

- `npm run build` succeeds.
- `npm start` starts the production server locally.
- `/health` returns `{ "ok": true, "service": "operit-mcp-bridge" }`.
- `/debug/mcp-info` shows the registered MCP tools.
- GitHub has the deploy branch pushed, preferably `main`.
- Cloud environment variables include `PORT` and, for protected HTTP API access, `BRIDGE_TOKEN`.
- Operit and ChatGPT use the cloud HTTPS URL, not a local LAN IP.

## Task Model

```json
{
  "taskId": "...",
  "deviceId": "phone1",
  "type": "screen_summary",
  "params": {},
  "createdAt": "...",
  "updatedAt": "...",
  "status": "pending"
}
```

Allowed statuses:

```text
pending
running
done
error
stopped
blocked_by_safety
stopped_by_stop_text
timeout
```

## Safety

The Bridge and Worker both block dangerous `tap_text` tasks.

Dangerous texts:

```json
["支付", "确认支付", "提交订单", "确认提交", "验证码", "发送", "删除", "转账"]
```

Status meanings:

- `blocked_by_safety`: requested action itself was dangerous and refused.
- `stopped_by_stop_text`: monitor saw sensitive page text such as payment, login, or captcha and stopped itself.

## Operit Worker

Edit:

```text
operit/remote_worker.js
```

Set:

```js
const config = {
  baseUrl: "https://your-bridge.example.com",
  deviceId: "phone1",
  pollIntervalMs: 3000,
};
```

The Worker currently has adapter placeholders for:

- `readScreenSummary`
- `tapText`
- `swipeDownRefresh`
- `notifyUser`

These should be replaced with real Operit APIs after you provide Operit script docs or screenshots.

## Deploy Recommendation

For the first hosted MVP, use Render or Railway. Both are straightforward for a Node.js HTTP service. Fly.io or a VPS are good once you want more control. Cloudflare Workers may be useful later, but its Node.js compatibility constraints can add friction for MCP and server dependencies.
