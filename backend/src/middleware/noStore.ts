import type { NextFunction, Request, Response } from "express";

// Every auth/session and authenticated-data response must never be served
// from a browser (or intermediate) cache: a role change, a logout, or a
// switch of accounts on the same machine must never see the previous
// user's cached response. `Cache-Control: no-store` on its own is not
// enough — Express independently computes an ETag for every JSON response
// and short-circuits to 304 whenever the request's `If-None-Match` matches
// it, regardless of this response's own Cache-Control header (see
// createApp's `app.set("etag", false)`, the actual fix for the 304 itself;
// this middleware is the explicit signal to the client/any proxy not to
// store the response at all).
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set("Cache-Control", "no-store");
  next();
}
