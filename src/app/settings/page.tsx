import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getClaudeInstructions, MAX_INSTRUCTIONS_LENGTH } from "@/lib/settings";
import { ClaudeInstructionsForm } from "@/components/ClaudeInstructionsForm";
import { ThreadNotesSettingsForm } from "@/components/ThreadNotesSettingsForm";
import { getThreadNotesSettings } from "@/lib/threadnotes";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const threadnotes = await getThreadNotesSettings(userId);

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
        />
      </section>
    </div>
  );
}
