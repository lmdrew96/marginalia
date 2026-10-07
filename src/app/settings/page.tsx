import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getClaudeInstructions, MAX_INSTRUCTIONS_LENGTH } from "@/lib/settings";
import { ClaudeInstructionsForm } from "@/components/ClaudeInstructionsForm";
import { ThreadNotesSettingsForm } from "@/components/ThreadNotesSettingsForm";
import {
  getLibrary,
  getThreadNotesSettings,
  type ThreadNotesProject,
} from "@/lib/threadnotes";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const threadnotes = await getThreadNotesSettings(userId);
  let projects: ThreadNotesProject[] = [];
  let threadnotesError: string | null = null;
  if (threadnotes.apiKey) {
    try {
      projects = (await getLibrary(threadnotes.apiKey)).projects;
    } catch (err) {
      console.error("Listing ThreadNotes projects failed:", err);
      threadnotesError =
        "Couldn't load your ThreadNotes projects. If your key changed, replace it.";
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-14">
      <div>
        <p className="eyebrow">Preferences</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight">
          Settings
        </h1>
      </div>
      <section className="rounded-xl border border-border p-6 shadow-sm">
        <ClaudeInstructionsForm
          initial={await getClaudeInstructions(userId)}
          maxLength={MAX_INSTRUCTIONS_LENGTH}
        />
      </section>
      <section className="rounded-xl border border-border p-6 shadow-sm">
        <ThreadNotesSettingsForm
          initialConnected={threadnotes.apiKey !== null}
          initialProjects={projects}
          initialProjectId={
            projects.some((p) => p.id === threadnotes.projectId)
              ? threadnotes.projectId
              : null
          }
          loadError={threadnotesError}
        />
      </section>
    </div>
  );
}
