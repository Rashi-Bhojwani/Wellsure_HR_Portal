// Shape of req.user once request authentication has run (see auth.ts,
// commit B — the JWT access-token verification middleware that populates
// this). RBAC/data-scope middleware here only ever *reads* req.user; they
// never populate it themselves.
export interface AuthenticatedUser {
  userId: string;
  employeeId: string;
  roleCodes: string[];
  permissions: Set<string>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- this is how Express's own type augmentation works
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
