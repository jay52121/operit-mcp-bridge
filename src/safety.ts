import type { SubmitTaskInput } from "./types.js";

export const DANGEROUS_TEXTS = [
  "支付",
  "确认支付",
  "提交订单",
  "确认提交",
  "验证码",
  "发送",
  "删除",
  "转账",
];

export interface SafetyResult {
  allowed: boolean;
  reason?: string;
  matchedText?: string;
}

export function findDangerousText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return DANGEROUS_TEXTS.find((dangerousText) => value.includes(dangerousText)) ?? null;
}

export function validateTaskSafety(input: SubmitTaskInput): SafetyResult {
  if (input.type !== "tap_text") {
    return { allowed: true };
  }

  const text = input.params?.text;
  const matchedText = findDangerousText(text);
  if (matchedText) {
    return {
      allowed: false,
      matchedText,
      reason: `tap_text is blocked by safety rule: ${matchedText}`,
    };
  }

  return { allowed: true };
}
