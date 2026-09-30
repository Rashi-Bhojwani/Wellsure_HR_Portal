import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import * as controller from "./controller";
import {
  addCommentSchema,
  autoPostKindParamsSchema,
  createGroupSchema,
  createPollSchema,
  createPostSchema,
  employeeSearchQuerySchema,
  giveKudosSchema,
  groupMemberParamsSchema,
  idParamsSchema,
  listFeedQuerySchema,
  listModerationQuerySchema,
  reactSchema,
  updateAutoPostSettingSchema,
  updateDailyRunHourSchema,
  updateGroupSchema,
  votePollSchema,
} from "./validators";

// Engage (spec §4, §7.7) — posting/kudos/polls/reactions/comments and
// browsing active groups are self-serve (every signed-in employee); group
// CRUD + membership need engage.groups.manage, moderation needs
// engage.moderate, auto-post template/timing config needs
// engage.autopost.manage — the same permission-at-the-route pattern every
// other admin-gated module in this codebase uses.
export const engageRouter = Router();
engageRouter.use(authenticate);

engageRouter.get("/employees/search", validate({ query: employeeSearchQuerySchema }), controller.searchEmployees);

engageRouter.get("/posts", validate({ query: listFeedQuerySchema }), controller.listFeed);
engageRouter.get("/posts/:id", validate({ params: idParamsSchema }), controller.getPost);
engageRouter.post("/posts", validate({ body: createPostSchema }), controller.createPost);

engageRouter.post("/kudos", validate({ body: giveKudosSchema }), controller.giveKudos);

engageRouter.post("/polls", validate({ body: createPollSchema }), controller.createPoll);
engageRouter.post("/polls/vote", validate({ body: votePollSchema }), controller.votePoll);
engageRouter.post("/posts/:id/close-poll", validate({ params: idParamsSchema }), controller.closePoll);

engageRouter.post("/posts/:id/react", validate({ params: idParamsSchema, body: reactSchema }), controller.toggleReaction);

engageRouter.get("/posts/:id/comments", validate({ params: idParamsSchema }), controller.listComments);
engageRouter.post("/posts/:id/comments", validate({ params: idParamsSchema, body: addCommentSchema }), controller.addComment);

engageRouter.get("/groups/active", controller.listActiveGroups);

const groupsManage = requirePermission("engage.groups.manage");
engageRouter.get("/groups", groupsManage, controller.listGroups);
engageRouter.post("/groups", groupsManage, validate({ body: createGroupSchema }), controller.createGroup);
engageRouter.patch("/groups/:id", groupsManage, validate({ params: idParamsSchema, body: updateGroupSchema }), controller.updateGroup);
engageRouter.get("/groups/:id/members", groupsManage, validate({ params: idParamsSchema }), controller.listMembers);
engageRouter.post("/groups/:id/members/:employeeId", groupsManage, validate({ params: groupMemberParamsSchema }), controller.addMember);
engageRouter.delete("/groups/:id/members/:employeeId", groupsManage, validate({ params: groupMemberParamsSchema }), controller.removeMember);

const moderate = requirePermission("engage.moderate");
engageRouter.get("/moderation/posts", moderate, validate({ query: listModerationQuerySchema }), controller.listPostsForModeration);
engageRouter.post("/moderation/posts/:id/hide", moderate, validate({ params: idParamsSchema }), controller.moderatePost);
engageRouter.post("/moderation/posts/:id/unhide", moderate, validate({ params: idParamsSchema }), controller.unmoderatePost);

const autopostManage = requirePermission("engage.autopost.manage");
engageRouter.get("/autopost-settings", autopostManage, controller.listAutoPostSettings);
engageRouter.patch("/autopost-settings/:kind", autopostManage, validate({ params: autoPostKindParamsSchema, body: updateAutoPostSettingSchema }), controller.updateAutoPostSetting);
engageRouter.put("/autopost-settings/daily-run-hour", autopostManage, validate({ body: updateDailyRunHourSchema }), controller.updateDailyRunHour);
