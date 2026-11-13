import type { TaskSource } from "../tasks/service";
import { openReviews } from "./nudgeTags";

// Directors' task: a receiver asked for a nudge tag to be reviewed. The preview names no tag and no person (the directors open the Recognition page).
export const nudgeReviewTasks: TaskSource = {
  type: "NUDGE_REVIEW",
  async list(viewer, limit) {
    if (!viewer.roleCodes.includes("SUPER_ADMIN") || viewer.roleCodes.includes("DEVELOPER")) return [];
    return (await openReviews()).slice(0, limit).map((r) => ({
      type: "NUDGE_REVIEW" as const,
      id: r.id,
      title: "A nudge review was requested",
      detail: null,
      employeeName: null,
      waitingSince: r.at.toISOString(),
      link: "/app/office/recognition",
      adminLink: "/app/office/recognition",
    }));
  },
};
