import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { folders, type Folder } from "@/db/schema";

const MAX_NAME_LENGTH = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A trimmed folder name, or an error to show. */
export const parseFolderName = (
  name: unknown,
): { name: string } | { error: string } => {
  if (typeof name !== "string" || !name.trim()) {
    return { error: "Give the folder a name." };
  }
  if (name.trim().length > MAX_NAME_LENGTH) {
    return { error: `Folder names can be at most ${MAX_NAME_LENGTH} characters.` };
  }
  return { name: name.trim() };
};

export const getOwnedFolder = async (
  folderId: string,
  userId: string,
): Promise<Folder | null> => {
  // Anything else would be a Postgres error, not a missing folder.
  if (!UUID.test(folderId)) return null;
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));
  return folder ?? null;
};

/** Whether another of the user's folders already has this name. */
export const folderNameTaken = async (
  userId: string,
  name: string,
  exceptId?: string,
): Promise<boolean> => {
  const [clash] = await db
    .select({ id: folders.id })
    .from(folders)
    .where(
      and(
        eq(folders.userId, userId),
        eq(folders.name, name),
        ...(exceptId ? [ne(folders.id, exceptId)] : []),
      ),
    );
  return Boolean(clash);
};
