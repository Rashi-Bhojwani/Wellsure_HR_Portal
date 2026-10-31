import { Router } from "express";
import { authenticate } from "../../middleware/authenticate";
import { requireAuth } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { requireDirector, requireOffice } from "../peeps/access";
import * as controller from "./controller";
import { authoriseSchema, bookSchema, completeSchema, createSlotSchema, employeeParams, idParams, reasonSchema, reassignSchema, rescheduleSchema } from "./validators";

// Unmute (D-29, D-30).
//   self       any employee (HR included, as an employee) while the directors' Unmute audience setting allows booking: free times, own bookings, book,
//              cancel, reschedule. Only ever the caller's own bookings.
//   /host/*    an authorised host: a Wellsure Office member (requireOffice) whom a director authorised (checked in the service). Own slots only.
//   /admin/*   the directors: hosts, every booking (opening someone else's is audited), the bookings left by a removed host.
export const unmuteRouter = Router();
unmuteRouter.use(authenticate, requireAuth);

unmuteRouter.get("/status", controller.status);
unmuteRouter.get("/slots", controller.openSlots);
unmuteRouter.get("/bookings/mine", controller.myBookings);
unmuteRouter.post("/bookings", validate({ body: bookSchema }), controller.book);
unmuteRouter.post("/bookings/:id/cancel", validate({ params: idParams }), controller.cancel);
unmuteRouter.post("/bookings/:id/reschedule", validate({ params: idParams, body: rescheduleSchema }), controller.reschedule);

const host = requireOffice("office.workspace");
unmuteRouter.get("/host/slots", host, controller.hostSlots);
unmuteRouter.post("/host/slots", host, validate({ body: createSlotSchema }), controller.createSlot);
unmuteRouter.post("/host/slots/:id/withdraw", host, validate({ params: idParams }), controller.withdrawSlot);
unmuteRouter.post("/host/bookings/:id/cancel", host, validate({ params: idParams }), controller.hostCancel);
unmuteRouter.post("/host/bookings/:id/complete", host, validate({ params: idParams, body: completeSchema }), controller.complete);

const director = requireDirector("unmute.manage");
unmuteRouter.get("/admin/hosts", director, controller.hosts);
unmuteRouter.post("/admin/hosts", director, validate({ body: authoriseSchema }), controller.authorise);
unmuteRouter.post("/admin/hosts/:employeeId/revoke", director, validate({ params: employeeParams, body: reasonSchema }), controller.revoke);
unmuteRouter.get("/admin/bookings", director, controller.allBookings);
unmuteRouter.get("/admin/bookings/:id", director, validate({ params: idParams }), controller.getBooking);
unmuteRouter.get("/admin/affected", director, controller.affected);
unmuteRouter.get("/admin/free-slots", director, controller.freeSlots);
unmuteRouter.post("/admin/bookings/:id/reassign", director, validate({ params: idParams, body: reassignSchema }), controller.reassign);
unmuteRouter.post("/admin/bookings/:id/cancel", director, validate({ params: idParams }), controller.adminCancel);
