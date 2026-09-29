import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";

// Admin Homepage "My Favourites" shortcut tiles (spec §7.1) — a per-user
// list, not a fixed admin-defined one, so this is entirely self-serve
// (every row is implicitly scoped to the caller's own userId).

function formatFavourite(row: { id: string; label: string; icon: string; path: string; rank: number }) {
  return { id: row.id, label: row.label, icon: row.icon, path: row.path, rank: row.rank };
}

export async function listFavourites(userId: string) {
  const rows = await prisma.userFavourite.findMany({ where: { userId }, orderBy: { rank: "asc" } });
  return rows.map(formatFavourite);
}

export interface CreateFavouriteInput {
  label: string;
  icon: string;
  path: string;
}

export async function createFavourite(userId: string, input: CreateFavouriteInput) {
  const maxRank = await prisma.userFavourite.aggregate({ where: { userId }, _max: { rank: true } });
  const row = await prisma.userFavourite.create({
    data: { userId, label: input.label, icon: input.icon, path: input.path, rank: (maxRank._max.rank ?? -1) + 1 },
  });
  return formatFavourite(row);
}

export async function deleteFavourite(userId: string, id: string): Promise<void> {
  const result = await prisma.userFavourite.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new HttpError(404, "Favourite not found.", "NOT_FOUND");
}

// Full replace of display order — the frontend sends the complete
// reordered id list after a drag, simpler and less error-prone than a
// single move-one-item delta endpoint.
export async function reorderFavourites(userId: string, orderedIds: string[]): Promise<void> {
  const owned = await prisma.userFavourite.findMany({ where: { userId }, select: { id: true } });
  const ownedIds = new Set(owned.map((r) => r.id));
  if (orderedIds.length !== ownedIds.size || !orderedIds.every((id) => ownedIds.has(id))) {
    throw new HttpError(400, "orderedIds must be exactly this user's current favourite ids.", "INVALID_REORDER");
  }
  await prisma.$transaction(orderedIds.map((id, index) => prisma.userFavourite.update({ where: { id }, data: { rank: index } })));
}
