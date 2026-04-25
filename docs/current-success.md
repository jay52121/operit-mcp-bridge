# Current Success Snapshot

Date: 2026-04-25

## Public Bridge

Public MCP endpoint:

```text
http://35.212.203.107:8787/mcp
```

Health endpoint:

```text
http://35.212.203.107:8787/health
```

## Successful Chain

The production Bridge on the VPS successfully completed this chain:

```text
ChatGPT/Codex or manual HTTP submit
-> VPS Operit MCP Bridge
-> Operit remote MCP client
-> Android UI read via Automatic_ui_base
-> operit_report_status
-> Bridge latestStatus/taskHistory
```

## Latest Successful Status

Source:

```text
GET /api/status?device_id=phone1
```

Summary:

```json
{
  "deviceId": "phone1",
  "online": false,
  "lastSeenAt": "2026-04-25T07:50:56.929Z",
  "latestStatus": {
    "deviceId": "phone1",
    "taskId": "dc651b6a-7c95-4594-affb-be07931c7c20",
    "status": "done",
    "payload": {
      "summary": "当前应用: com.ai.assistance.operit, 当前活动: com.ai.assistance.operit.ui.main.MainActivityDefaultLauncherAlias",
      "texts": [
        "显示历史",
        "开启悬浮窗",
        "Operit",
        "请严格按顺序执行：",
        "Response",
        "工具调用",
        "工具结果",
        "看起来 operit_bridge 包尚未激活。",
        "我已成功获取到任务。",
        "正在执行工具: Automatic_ui_base:g...",
        "请输入您的问题...",
        "AI 对话",
        "AI电脑",
        "代码编辑器"
      ]
    },
    "receivedAt": "2026-04-25T07:50:56.929Z"
  },
  "currentTask": null,
  "pendingTasks": [],
  "pendingCount": 0,
  "taskHistory": [
    {
      "taskId": "dc651b6a-7c95-4594-affb-be07931c7c20",
      "deviceId": "phone1",
      "type": "screen_summary",
      "params": {},
      "createdAt": "2026-04-25T07:48:22.684Z",
      "updatedAt": "2026-04-25T07:50:56.929Z",
      "status": "done"
    }
  ]
}
```

## State Rules Confirmed

- `screen_summary` with `done` clears `currentTask`.
- Finished tasks are moved into `taskHistory`.
- `pendingTasks` does not retain completed tasks.
- `page_monitor_running` is not terminal and must not clear `currentTask`.
- Terminal statuses include `found_target`, `done`, `error`, `timeout`, `stopped`, `stopped_by_stop_text`, and `blocked_by_safety`.
