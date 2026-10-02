import { Router, type Request, type Response } from "express";
import { authenticate } from "../../middleware/authenticate";
import * as service from "./service";

// Tasks inbox — self-serve: every source applies its own permission and
// scope checks (see service.ts), so a plain employee simply gets [].
export const tasksRouter = Router();
tasksRouter.use(authenticate);

tasksRouter.get("/mine", async (req: Request, res: Response) => {
  const user = req.user!;
  res.status(200).json(await service.listMyTasks({ employeeId: user.employeeId, roleCodes: user.roleCodes, dataScope: user.dataScope, permissions: user.permissions }));
});
