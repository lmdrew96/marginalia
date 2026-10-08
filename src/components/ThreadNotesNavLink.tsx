import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { getThreadNotesSettings } from "@/lib/threadnotes";
import { BookOpenIcon } from "@/components/icons";

/** Top-bar link to the ThreadNotes reading room, once ThreadNotes is connected. */
export const ThreadNotesNavLink = async (): Promise<React.JSX.Element | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const { apiKey } = await getThreadNotesSettings(userId);
  if (!apiKey) return null;
  return (
    <Link
      href="/threadnotes"
      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-secondary transition-colors hover:bg-surface hover:text-on-surface"
    >
      <BookOpenIcon className="h-4 w-4" />
      <span className="hidden sm:inline">ThreadNotes</span>
      <span className="sr-only sm:hidden">ThreadNotes</span>
    </Link>
  );
};
