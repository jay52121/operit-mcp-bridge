/*
METADATA
{
  "name": "operit_remote_worker",
  "description": "Poll an Operit MCP Bridge for safe Android UI tasks and report results.",
  "tools": [
    {
      "name": "run_remote_worker",
      "description": "Start polling a remote Operit Bridge for tasks.",
      "parameters": {
        "type": "object",
        "properties": {
          "baseUrl": {
            "type": "string",
            "description": "Bridge base URL, for example https://your-bridge.example.com"
          },
          "deviceId": {
            "type": "string",
            "description": "Device ID registered with the bridge, for example phone1"
          },
          "intervalMs": {
            "type": "number",
            "description": "Polling interval in milliseconds"
          },
          "maxPolls": {
            "type": "number",
            "description": "Maximum poll count before the worker exits"
          }
        },
        "required": ["baseUrl", "deviceId"]
      }
    }
  ]
}
*/

const RemoteWorker = (function () {
  const DANGEROUS_TEXTS = ["支付", "确认支付", "提交订单", "确认提交", "验证码", "发送", "删除", "转账"];
  const DEFAULT_INTERVAL_MS = 3000;
  const DEFAULT_MAX_POLLS = 300;
  const DEFAULT_MONITOR_INTERVAL_MS = 5000;
  const DEFAULT_MONITOR_MAX_ROUNDS = 60;
  const MAX_TEXTS = 100;
  const MAX_TREE_PREVIEW_CHARS = 6000;

  let shouldStop = false;

  async function wrap(func, params) {
    try {
      const result = await func(params || {});
      complete(result);
    } catch (e) {
      complete({ success: false, error: stringifyError(e) });
    }
  }

  async function run_remote_worker(params) {
    const config = normalizeConfig(params);
    const summary = {
      success: true,
      deviceId: config.deviceId,
      polls: 0,
      tasksHandled: 0,
      lastResult: null,
    };

    shouldStop = false;

    await reportWorkerAlive(config);

    for (let poll = 1; poll <= config.maxPolls; poll += 1) {
      summary.polls = poll;

      if (shouldStop) {
        summary.lastResult = { status: "stopped", message: "worker stopped" };
        return summary;
      }

      try {
        const next = await pollNextTask(config);
        if (!next || next.type === "none") {
          await Tools.System.sleep(config.intervalMs);
          continue;
        }

        if (next.type !== "task" || !next.task) {
          summary.lastResult = { status: "ignored", message: "unexpected next-task response", response: next };
          await Tools.System.sleep(config.intervalMs);
          continue;
        }

        summary.tasksHandled += 1;
        summary.lastResult = await executeTask(config, next.task);
      } catch (e) {
        summary.lastResult = { status: "poll_error", error: stringifyError(e) };
        await Tools.System.sleep(config.intervalMs);
      }
    }

    return summary;
  }

  function normalizeConfig(params) {
    if (!params.baseUrl || !params.deviceId) {
      throw new Error("baseUrl and deviceId are required");
    }

    return {
      baseUrl: String(params.baseUrl).replace(/\/+$/, ""),
      deviceId: String(params.deviceId),
      intervalMs: positiveNumber(params.intervalMs, DEFAULT_INTERVAL_MS),
      maxPolls: positiveNumber(params.maxPolls, DEFAULT_MAX_POLLS),
    };
  }

  function positiveNumber(value, fallback) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
  }

  async function requestJson(method, url, body) {
    const normalizedMethod = String(method || "GET").toUpperCase();
    let response;

    if (normalizedMethod === "GET") {
      response = await Tools.Network.httpGet(url);
    } else if (normalizedMethod === "POST") {
      response = await Tools.Network.httpPost(url, JSON.stringify(body || {}));
    } else {
      throw new Error("unsupported HTTP method: " + normalizedMethod);
    }

    return normalizeNetworkResponse(response);
  }

  function normalizeNetworkResponse(response) {
    if (typeof response === "string") {
      return parseJsonMaybe(response);
    }

    if (!response || typeof response !== "object") {
      return response;
    }

    const fields = ["body", "data", "content", "text", "result", "value"];
    for (let i = 0; i < fields.length; i += 1) {
      const value = response[fields[i]];
      if (typeof value === "string") {
        return parseJsonMaybe(value);
      }
      if (value && typeof value === "object") {
        return value;
      }
    }

    return response;
  }

  function parseJsonMaybe(value) {
    try {
      return JSON.parse(value);
    } catch (_e) {
      return value;
    }
  }

  async function pollNextTask(config) {
    const url = config.baseUrl + "/api/next-task?device_id=" + encodeURIComponent(config.deviceId);
    return requestJson("GET", url);
  }

  async function reportStatus(config, task, status, message, payload, extra) {
    const url = config.baseUrl + "/api/report-status";
    const body = {
      deviceId: config.deviceId,
      taskId: task && task.taskId,
      status: status,
      message: message || "",
      taskType: task && task.type,
      payload: payload || {},
      details: extra || {},
    };
    return requestJson("POST", url, body);
  }

  async function reportWorkerAlive(config) {
    const url = config.baseUrl + "/api/report-status";
    return requestJson("POST", url, {
      deviceId: config.deviceId,
      status: "alive",
      message: "remote worker started",
      taskType: "worker",
      payload: { source: "run_remote_worker" },
    });
  }

  async function executeTask(config, task) {
    try {
      if (task.type === "screen_summary") {
        return runScreenSummary(config, task);
      }
      if (task.type === "page_monitor") {
        return runPageMonitor(config, task);
      }
      if (task.type === "tap_text") {
        return runTapText(config, task);
      }
      if (task.type === "stop") {
        return runStop(config, task);
      }
      if (task.type === "ping") {
        return runPing(config, task);
      }

      await reportStatus(config, task, "error", "unknown task type: " + task.type, {});
      return { status: "error", taskId: task.taskId, message: "unknown task type: " + task.type };
    } catch (e) {
      const error = stringifyError(e);
      await reportStatus(config, task, "error", error, {}, { error: error });
      return { status: "error", taskId: task && task.taskId, error: error };
    }
  }

  async function runScreenSummary(config, task) {
    try {
      const payload = await buildScreenSummary();
      await reportStatus(config, task, "done", "screen summary captured", payload);
      return { status: "done", taskId: task.taskId, taskType: "screen_summary", payload: payload };
    } catch (e) {
      const error = stringifyError(e);
      await reportStatus(config, task, "error", error, { taskType: "screen_summary" });
      return { status: "error", taskId: task.taskId, taskType: "screen_summary", error: error };
    }
  }

  async function runPageMonitor(config, task) {
    const params = task.params || {};
    const targetTexts = arrayOfStrings(params.targetTexts);
    const stopTexts = arrayOfStrings(params.stopTexts);
    const intervalMs = positiveNumber(params.intervalMs, DEFAULT_MONITOR_INTERVAL_MS);
    const maxRounds = positiveNumber(params.maxRounds, DEFAULT_MONITOR_MAX_ROUNDS);
    const refreshMode = params.refreshMode || "swipe_down";

    shouldStop = false;

    for (let round = 1; round <= maxRounds; round += 1) {
      if (shouldStop) {
        await reportStatus(config, task, "stopped", "page monitor stopped", { round: round });
        return { status: "stopped", taskId: task.taskId, round: round };
      }

      const page = await UINode.getCurrentPage();
      const summary = summarizePage(page);
      const pageText = summaryToText(summary);

      const matchedStopText = findFirstIncluded(pageText, stopTexts);
      if (matchedStopText) {
        const payload = { matchedText: matchedStopText, round: round };
        await reportStatus(config, task, "stopped_by_stop_text", "stopped by stop text: " + matchedStopText, payload);
        return { status: "stopped_by_stop_text", taskId: task.taskId, payload: payload };
      }

      const matchedTargetText = findFirstIncluded(pageText, targetTexts);
      if (matchedTargetText) {
        const payload = { matchedText: matchedTargetText, round: round };
        await reportStatus(config, task, "found_target", "found target text: " + matchedTargetText, payload);
        return { status: "found_target", taskId: task.taskId, payload: payload };
      }

      await reportStatus(config, task, "page_monitor_running", "page monitor running", { round: round });

      if (refreshMode === "swipe_down") {
        await Tools.UI.swipe(540, 900, 540, 1600);
      }

      await Tools.System.sleep(intervalMs);
    }

    await reportStatus(config, task, "timeout", "page monitor reached maxRounds", { maxRounds: maxRounds });
    return { status: "timeout", taskId: task.taskId, maxRounds: maxRounds };
  }

  async function runTapText(config, task) {
    const text = task.params && task.params.text;
    if (!text || typeof text !== "string") {
      await reportStatus(config, task, "error", "tap_text requires params.text", {});
      return { status: "error", taskId: task.taskId, message: "tap_text requires params.text" };
    }

    const dangerousText = findDangerousText(text);
    if (dangerousText) {
      const payload = { matchedText: dangerousText, text: text };
      await reportStatus(config, task, "blocked_by_safety", "blocked dangerous tap text: " + dangerousText, payload);
      return { status: "blocked_by_safety", taskId: task.taskId, payload: payload };
    }

    const page = await UINode.getCurrentPage();
    const node = page && typeof page.findByText === "function" ? page.findByText(text) : null;

    if (!node) {
      await reportStatus(config, task, "error", "text not found: " + text, { text: text });
      return { status: "error", taskId: task.taskId, message: "text not found: " + text };
    }

    await node.click();
    await reportStatus(config, task, "done", "tapped text: " + text, { text: text });
    return { status: "done", taskId: task.taskId, text: text };
  }

  async function runStop(config, task) {
    shouldStop = true;
    await reportStatus(config, task, "stopped", "stop requested", {});
    return { status: "stopped", taskId: task.taskId };
  }

  async function runPing(config, task) {
    const payload = { message: "pong" };
    await reportStatus(config, task, "done", "pong", payload);
    return { status: "done", taskId: task.taskId, payload: payload };
  }

  async function buildScreenSummary() {
    const page = await UINode.getCurrentPage();
    return summarizePage(page);
  }

  function summarizePage(page) {
    const texts = [];
    const nodesPreview = [];
    const seen = [];

    collectNode(page, texts, nodesPreview, seen, 0);

    let treePreview = JSON.stringify(nodesPreview);
    if (treePreview.length > MAX_TREE_PREVIEW_CHARS) {
      treePreview = treePreview.slice(0, MAX_TREE_PREVIEW_CHARS);
    }

    return {
      texts: texts.slice(0, MAX_TEXTS),
      nodesPreview: nodesPreview,
      tree_preview: treePreview,
    };
  }

  function collectNode(node, texts, nodesPreview, seen, depth) {
    if (!node || typeof node !== "object") {
      return;
    }
    if (seen.indexOf(node) >= 0) {
      return;
    }
    seen.push(node);

    const item = {
      text: safeString(node.text),
      contentDesc: safeString(node.contentDesc),
      resourceId: safeString(node.resourceId),
      className: safeString(node.className),
      bounds: safeValue(node.bounds),
      depth: depth,
    };

    if (item.text && texts.length < MAX_TEXTS) {
      texts.push(item.text);
    }
    if (item.contentDesc && texts.length < MAX_TEXTS) {
      texts.push(item.contentDesc);
    }

    if (nodesPreview.length < MAX_TEXTS) {
      nodesPreview.push(item);
    }

    const children = getChildren(node);
    for (let i = 0; i < children.length; i += 1) {
      collectNode(children[i], texts, nodesPreview, seen, depth + 1);
      if (texts.length >= MAX_TEXTS && nodesPreview.length >= MAX_TEXTS) {
        break;
      }
    }
  }

  function getChildren(node) {
    const fields = ["children", "childNodes", "nodes", "childrenNodes"];
    for (let i = 0; i < fields.length; i += 1) {
      const value = node[fields[i]];
      if (Array.isArray(value)) {
        return value;
      }
    }
    return [];
  }

  function summaryToText(summary) {
    if (!summary) {
      return "";
    }
    if (Array.isArray(summary.texts)) {
      return summary.texts.join("\n") + "\n" + JSON.stringify(summary.nodesPreview || []);
    }
    return JSON.stringify(summary);
  }

  function arrayOfStrings(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(function (item) {
      return typeof item === "string" && item.length > 0;
    });
  }

  function findFirstIncluded(source, candidates) {
    for (let i = 0; i < candidates.length; i += 1) {
      if (source.indexOf(candidates[i]) >= 0) {
        return candidates[i];
      }
    }
    return null;
  }

  function findDangerousText(text) {
    return findFirstIncluded(text, DANGEROUS_TEXTS);
  }

  function safeString(value) {
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  }

  function safeValue(value) {
    if (value === null || value === undefined) {
      return null;
    }
    try {
      JSON.stringify(value);
      return value;
    } catch (_e) {
      return String(value);
    }
  }

  function stringifyError(e) {
    return String(e && e.message ? e.message : e);
  }

  return {
    run_remote_worker: function (params) {
      return wrap(run_remote_worker, params);
    },
  };
})();

if (typeof exports !== "undefined") {
  exports.run_remote_worker = RemoteWorker.run_remote_worker;
}

if (typeof globalThis !== "undefined") {
  globalThis.RemoteWorker = RemoteWorker;
  globalThis.run_remote_worker = RemoteWorker.run_remote_worker;
}
