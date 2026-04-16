import type { SessionStatus } from "@/lib/api/sessions/dtos";

export const SESSION_STATUS_CLASSES: Record<SessionStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  ready: "bg-blue-50 text-blue-700",
  generating: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
};
