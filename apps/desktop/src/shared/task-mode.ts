import type { Task, TaskMode } from "./types.js";

const labels: Record<TaskMode, string> = {
  default: "Default",
};

export function taskModeLabel(task: Pick<Task, "mode">): string {
  return labels[task.mode ?? "default"];
}
