import type { Request, Response } from "express";
import * as directory from "./directory";
import * as photos from "./photos";

export async function listDirectory(req: Request, res: Response): Promise<void> {
  res.status(200).json(await directory.listDirectory(req.query as never as directory.ListDirectoryQuery));
}

export async function getDirectoryEntry(req: Request, res: Response): Promise<void> {
  res.status(200).json(await directory.getDirectoryEntry(req.params.id as string));
}

export async function getOrgChart(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await directory.getOrgChart());
}

export async function getPhotoToken(req: Request, res: Response): Promise<void> {
  res.status(200).json(photos.issuePhotoToken(req.user!.userId));
}

export async function servePhoto(req: Request, res: Response): Promise<void> {
  const { employeeId, size } = req.params as { employeeId: string; size: "thumb" | "full" };
  const { t } = req.query as { t?: string };
  const photo = await photos.readPhotoForViewer(t, employeeId, size);
  // Cacheable, deliberately unlike every other /api response (middleware/
  // noStore.ts): the URL carries the viewer's own token and the photo's
  // version, so another user never hits this user's cache entry and a
  // changed photo gets a new URL. `private` keeps shared proxies out.
  res.set("Cache-Control", "private, max-age=86400");
  // Our own frontend (hr.<domain> / localhost:5173) loads these cross-origin
  // from the API origin; helmet's default same-origin CORP would block that.
  res.set("Cross-Origin-Resource-Policy", "same-site");
  res.type(photo.contentType).send(photo.body);
}
