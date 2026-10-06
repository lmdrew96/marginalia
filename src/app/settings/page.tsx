import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getClaudeInstructions, MAX_INSTRUCTIONS_LENGTH } from "@/lib/settings";
import { ClaudeInstructionsForm } from "@/components/ClaudeInstructionsForm";

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <ClaudeInstructionsForm
        initial={await getClaudeInstructions(userId)}
        maxLength={MAX_INSTRUCTIONS_LENGTH}
      />
    </div>
  );
}
