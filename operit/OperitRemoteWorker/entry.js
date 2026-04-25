const BASE_URL =
  typeof process !== "undefined" && process.env && process.env.OPERIT_BRIDGE_URL
    ? process.env.OPERIT_BRIDGE_URL
    : "https://your-koyeb-app.koyeb.app";
const DEVICE_ID = "phone1";
const INTERVAL_MS = 3000;
const MAX_POLLS = 300;
const WORKER_PATH = "/storage/emulated/0/Download/Operit/skills/OperitRemoteWorker/remote_worker.js";

function nowIso() {
  return new Date().toISOString();
}

function getNodeHttpModule(url) {
  if (typeof require !== "function") {
    return null;
  }
  return url.indexOf("https://") === 0 ? require("https") : require("http");
}

function nodeRequest(method, url, body) {
  return new Promise((resolve, reject) => {
    const httpModule = getNodeHttpModule(url);
    if (!httpModule) {
      reject(new Error("node require/http is not available"));
      return;
    }

    const payload = body ? JSON.stringify(body) : "";
    const req = httpModule.request(url, {
      method: method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve(data);
      });
    });

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

async function postJson(url, body) {
  if (typeof require === "function") {
    return nodeRequest("POST", url, body);
  }

  if (
    typeof Tools !== "undefined" &&
    Tools.Network &&
    typeof Tools.Network.httpPost === "function"
  ) {
    return Tools.Network.httpPost(url, JSON.stringify(body));
  }

  throw new Error("entry.js has neither node http nor Tools.Network.httpPost");
}

async function startupHeartbeat() {
  return postJson(BASE_URL + "/api/report-status", {
    device_id: DEVICE_ID,
    task_id: "startup",
    status: "worker_started",
    payload: {
      message: "entry.js started",
      time: nowIso(),
    },
  });
}

function installNodeToolShims() {
  if (typeof require !== "function") {
    return;
  }

  if (typeof globalThis.Tools === "undefined") {
    globalThis.Tools = {};
  }

  if (!globalThis.Tools.System) {
    globalThis.Tools.System = {};
  }
  if (typeof globalThis.Tools.System.sleep !== "function") {
    globalThis.Tools.System.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  }

  if (!globalThis.Tools.Network) {
    globalThis.Tools.Network = {};
  }
  if (typeof globalThis.Tools.Network.httpGet !== "function") {
    globalThis.Tools.Network.httpGet = (url) => nodeRequest("GET", url);
  }
  if (typeof globalThis.Tools.Network.httpPost !== "function") {
    globalThis.Tools.Network.httpPost = (url, body) => {
      let parsedBody = body;
      if (typeof body === "string") {
        try {
          parsedBody = JSON.parse(body);
        } catch (_e) {
          parsedBody = body;
        }
      }
      return nodeRequest("POST", url, parsedBody);
    };
  }
}

async function loadWorker() {
  installNodeToolShims();

  if (typeof globalThis.complete !== "function") {
    globalThis.complete = (result) => {
      console.log(JSON.stringify(result, null, 2));
    };
  }

  if (typeof require === "function") {
    const workerModule = require(WORKER_PATH);
    return workerModule.run_remote_worker || globalThis.run_remote_worker;
  }

  return globalThis.run_remote_worker;
}

(async function main() {
  console.log("entry.js starting", { baseUrl: BASE_URL, deviceId: DEVICE_ID });

  const heartbeatResult = await startupHeartbeat();
  console.log("worker_started heartbeat result:", heartbeatResult);

  const runRemoteWorker = await loadWorker();
  if (typeof runRemoteWorker !== "function") {
    throw new Error("run_remote_worker is not available after loading remote_worker.js");
  }

  await runRemoteWorker({
    baseUrl: BASE_URL,
    deviceId: DEVICE_ID,
    intervalMs: INTERVAL_MS,
    maxPolls: MAX_POLLS,
  });
})();
