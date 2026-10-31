import type { Request, Response } from "express";
import { actorFor, metaOf } from "../peeps/access";
import * as service from "./service";

const id = (req: Request) => req.params.id as string;

// Employee (self)
export async function status(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.status(await actorFor(req)));
}
export async function openSlots(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.openSlots(await actorFor(req)));
}
export async function myBookings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.myBookings(await actorFor(req)));
}
export async function book(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.book(await actorFor(req), req.body, metaOf(req)));
}
export async function cancel(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.cancelAsBooker(await actorFor(req), id(req), metaOf(req)));
}
export async function reschedule(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.reschedule(await actorFor(req), id(req), req.body, metaOf(req)));
}

// Host
export async function hostSlots(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.hostSlots(await actorFor(req)));
}
export async function createSlot(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createSlot(await actorFor(req), req.body, metaOf(req)));
}
export async function withdrawSlot(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.withdrawSlot(await actorFor(req), id(req), metaOf(req)));
}
export async function hostCancel(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.cancelAsHost(await actorFor(req), id(req), metaOf(req)));
}
export async function complete(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.complete(await actorFor(req), id(req), req.body, metaOf(req)));
}

// Directors
export async function hosts(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.hosts());
}
export async function authorise(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.authoriseHost(req.body.employeeId as string, req.body, await actorFor(req), metaOf(req)));
}
export async function revoke(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.revokeHost(req.params.employeeId as string, req.body, await actorFor(req), metaOf(req)));
}
export async function allBookings(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.allBookings(await actorFor(req), metaOf(req)));
}
export async function getBooking(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getBooking(id(req), await actorFor(req), metaOf(req)));
}
export async function affected(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.affectedBookings(await actorFor(req), metaOf(req)));
}
export async function freeSlots(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.freeSlots());
}
export async function reassign(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.reassign(id(req), req.body, metaOf(req)));
}
export async function adminCancel(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.cancelAsSystem(id(req), metaOf(req)));
}
