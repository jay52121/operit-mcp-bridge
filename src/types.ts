export const TASK_TYPES = [
  "screen_summary",
  "page_monitor",
  "tap_text",
  "stop",
] as const;

export const TASK_STATUSES = [
  "pending",
  "running",
  "done",
  "error",
  "stopped",
  "blocked_by_safety",
  "stopped_by_stop_text",
  "timeout",
  "found_target",
  "page_monitor_running",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface OperitTask {
  taskId: string;
  deviceId: string;
  type: TaskType;
  params: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  status: TaskStatus;
}

export interface OperitStatusReport {
  deviceId: string;
  taskId?: string;
  status: TaskStatus | "alive";
  message?: string;
  taskType?: string;
  payload?: unknown;
  screenSummary?: unknown;
  error?: unknown;
  receivedAt: string;
  details?: Record<string, unknown>;
}

export interface DeviceState {
  deviceId: string;
  lastSeenAt: string;
}

export interface DeviceSnapshot {
  deviceId: string;
  online: boolean;
  lastSeenAt: string | null;
  latestStatus: OperitStatusReport | null;
  currentTask: OperitTask | null;
  pendingTasks: OperitTask[];
  pendingCount: number;
  taskHistory: OperitTask[];
}

export interface SubmitTaskInput {
  deviceId: string;
  type: TaskType;
  params?: Record<string, unknown>;
}
