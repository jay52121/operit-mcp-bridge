import { randomUUID } from "node:crypto";
import type {
  DeviceSnapshot,
  DeviceState,
  OperitStatusReport,
  OperitTask,
  SubmitTaskInput,
  TaskStatus,
} from "./types.js";

const TERMINAL_STATUSES = new Set<TaskStatus>([
  "done",
  "error",
  "stopped",
  "blocked_by_safety",
  "stopped_by_stop_text",
  "timeout",
  "found_target",
]);

export interface OperitStore {
  submitTask(input: SubmitTaskInput): OperitTask;
  submitBlockedTask(input: SubmitTaskInput, message: string): OperitTask;
  getNextTask(deviceId: string): OperitTask | null;
  reportStatus(report: Omit<OperitStatusReport, "receivedAt">): OperitStatusReport;
  clearCurrentTask(input: {
    deviceId: string;
    status: TaskStatus;
    reason?: string;
  }): { cleared: boolean; task: OperitTask | null; status: OperitStatusReport };
  getStatus(deviceId: string): DeviceSnapshot;
  touchDevice(deviceId: string): DeviceState;
}

export class MemoryOperitStore implements OperitStore {
  private readonly pendingTasks = new Map<string, OperitTask[]>();
  private readonly currentTask = new Map<string, OperitTask>();
  private readonly latestStatus = new Map<string, OperitStatusReport>();
  private readonly taskHistory = new Map<string, OperitTask[]>();
  private readonly devices = new Map<string, DeviceState>();

  constructor(private readonly onlineWindowMs = 30_000) {}

  submitTask(input: SubmitTaskInput): OperitTask {
    const now = new Date().toISOString();
    const task: OperitTask = {
      taskId: randomUUID(),
      deviceId: input.deviceId,
      type: input.type,
      params: input.params ?? {},
      createdAt: now,
      updatedAt: now,
      status: "pending",
    };

    const queue = this.pendingTasks.get(input.deviceId) ?? [];
    queue.push(task);
    this.pendingTasks.set(input.deviceId, queue);
    return task;
  }

  submitBlockedTask(input: SubmitTaskInput, message: string): OperitTask {
    const now = new Date().toISOString();
    const task: OperitTask = {
      taskId: randomUUID(),
      deviceId: input.deviceId,
      type: input.type,
      params: input.params ?? {},
      createdAt: now,
      updatedAt: now,
      status: "blocked_by_safety",
    };

    this.pushHistory(input.deviceId, task);
    this.latestStatus.set(input.deviceId, {
      deviceId: input.deviceId,
      taskId: task.taskId,
      status: "blocked_by_safety",
      message,
      receivedAt: now,
    });
    return task;
  }

  getNextTask(deviceId: string): OperitTask | null {
    this.touchDevice(deviceId);

    const runningTask = this.currentTask.get(deviceId);
    if (runningTask) {
      return runningTask;
    }

    const queue = this.pendingTasks.get(deviceId) ?? [];
    const task = queue.shift() ?? null;
    this.pendingTasks.set(deviceId, queue);

    if (!task) {
      return null;
    }

    const running: OperitTask = {
      ...task,
      status: "running",
      updatedAt: new Date().toISOString(),
    };
    this.currentTask.set(deviceId, running);
    return running;
  }

  reportStatus(report: Omit<OperitStatusReport, "receivedAt">): OperitStatusReport {
    this.touchDevice(report.deviceId);

    const receivedAt = new Date().toISOString();
    const savedReport: OperitStatusReport = {
      ...report,
      receivedAt,
    };
    this.latestStatus.set(report.deviceId, savedReport);

    if (report.taskId && TERMINAL_STATUSES.has(report.status as TaskStatus)) {
      const current = this.currentTask.get(report.deviceId);
      if (current && current.taskId === report.taskId) {
        const finished: OperitTask = {
          ...current,
          status: report.status as TaskStatus,
          updatedAt: receivedAt,
        };
        this.currentTask.delete(report.deviceId);
        this.pushHistory(report.deviceId, finished);
      }
    }

    return savedReport;
  }

  clearCurrentTask(input: {
    deviceId: string;
    status: TaskStatus;
    reason?: string;
  }): { cleared: boolean; task: OperitTask | null; status: OperitStatusReport } {
    this.touchDevice(input.deviceId);

    const receivedAt = new Date().toISOString();
    const current = this.currentTask.get(input.deviceId) ?? null;
    const savedReport: OperitStatusReport = {
      deviceId: input.deviceId,
      taskId: current?.taskId,
      status: input.status,
      message: input.reason,
      payload: input.reason ? { reason: input.reason } : {},
      receivedAt,
    };

    this.latestStatus.set(input.deviceId, savedReport);

    if (!current) {
      return { cleared: false, task: null, status: savedReport };
    }

    const finished: OperitTask = {
      ...current,
      status: input.status,
      updatedAt: receivedAt,
    };
    this.currentTask.delete(input.deviceId);
    this.pushHistory(input.deviceId, finished);

    return { cleared: true, task: finished, status: savedReport };
  }

  getStatus(deviceId: string): DeviceSnapshot {
    const device = this.devices.get(deviceId);
    const lastSeenAt = device?.lastSeenAt ?? null;
    const online =
      lastSeenAt !== null && Date.now() - new Date(lastSeenAt).getTime() < this.onlineWindowMs;

    return {
      deviceId,
      online,
      lastSeenAt,
      latestStatus: this.latestStatus.get(deviceId) ?? null,
      currentTask: this.currentTask.get(deviceId) ?? null,
      pendingTasks: [...(this.pendingTasks.get(deviceId) ?? [])],
      pendingCount: this.pendingTasks.get(deviceId)?.length ?? 0,
      taskHistory: [...(this.taskHistory.get(deviceId) ?? [])],
    };
  }

  touchDevice(deviceId: string): DeviceState {
    const device = {
      deviceId,
      lastSeenAt: new Date().toISOString(),
    };
    this.devices.set(deviceId, device);
    return device;
  }

  private pushHistory(deviceId: string, task: OperitTask): void {
    const history = this.taskHistory.get(deviceId) ?? [];
    history.unshift(task);
    this.taskHistory.set(deviceId, history.slice(0, 50));
  }
}
