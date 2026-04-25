# OperitRemoteWorker

OperitRemoteWorker connects this phone to a remote Operit MCP Bridge.

## Purpose

- Connect to a remote Bridge over HTTP.
- Poll tasks from `/api/next-task`.
- Report task results to `/api/report-status`.
- Support `ping` and `screen_summary` tasks in the first test flow.
- Includes `page_monitor` support for monitor-only page checks, with safe stop-text handling.

## Entry

Use the exported tool:

```js
run_remote_worker({
  baseUrl: "https://your-bridge.example.com",
  deviceId: "phone1",
  intervalMs: 3000,
  maxPolls: 300
})
```

For hosted testing, replace `baseUrl` with the Koyeb HTTPS address, for example:

```js
run_remote_worker({
  baseUrl: "https://your-koyeb-app.koyeb.app",
  deviceId: "phone1",
  intervalMs: 3000,
  maxPolls: 300
})
```

## Safety

This skill only reads page text, polls tasks, reports status, and performs explicitly requested safe actions.
Dangerous text clicks such as payment, order submission, captcha, sending, deletion, and transfer are blocked.
