import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userSettings } from "@/db/schema";
import {
  getLibrary,
  getThreadNotesSettings,
  ThreadNotesError,
} from "@/lib/threadnotes";

const MAX_KEY_LENGTH = 500;

const upsert = async (
  userId: string,
  values: { threadnotesApiKey?: string | null; threadnotesProjectId: string | null },
): Promise<void> => {
  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: { ...values, updatedAt: new Date() },
    });
};

/**
 * Connects ThreadNotes ({ apiKey }), disconnects it ({ apiKey: null }), or
 * picks the project to read from ({ projectId }). The key is checked with
 * ThreadNotes before it's saved, and never sent back.
 */
export async function PUT(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { apiKey, projectId } = await req.json();

  if (apiKey === null) {
    await upsert(userId, { threadnotesApiKey: null, threadnotesProjectId: null });
    return NextResponse.json({ connected: false });
  }

  if (apiKey !== undefined) {
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!key || key.length > MAX_KEY_LENGTH) {
      return NextResponse.json(
        { error: "Paste your ThreadNotes API key" },
        { status: 400 },
      );
    }
    try {
      const { projects } = await getLibrary(key);
      // A new key can belong to another account, so the old project goes.
      await upsert(userId, { threadnotesApiKey: key, threadnotesProjectId: null });
      return NextResponse.json({ connected: true, projectId: null, projects });
    } catch (err) {
      console.error("ThreadNotes key check failed:", err);
      const rejected =
        err instanceof ThreadNotesError && (err.status === 401 || err.status === 403);
      return NextResponse.json(
        {
          error: rejected
            ? "ThreadNotes didn't accept that key."
            : "Couldn't reach ThreadNotes to check that key. Try again.",
        },
        { status: rejected ? 400 : 502 },
      );
    }
  }

  if (typeof projectId === "string" && projectId) {
    const { apiKey: savedKey } = await getThreadNotesSettings(userId);
    if (!savedKey) {
      return NextResponse.json(
        { error: "Connect ThreadNotes first" },
        { status: 409 },
      );
    }
    try {
      await getLibrary(savedKey, projectId);
    } catch (err) {
      console.error("ThreadNotes project check failed:", err);
      const missing = err instanceof ThreadNotesError && err.status === 404;
      return NextResponse.json(
        {
          error: missing
            ? "ThreadNotes doesn't have that project anymore."
            : "Couldn't reach ThreadNotes. Try again.",
        },
        { status: missing ? 400 : 502 },
      );
    }
    await upsert(userId, { threadnotesProjectId: projectId });
    return NextResponse.json({ connected: true, projectId });
  }

  return NextResponse.json(
    { error: "apiKey or projectId is required" },
    { status: 400 },
  );
}
