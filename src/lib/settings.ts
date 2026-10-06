import { db } from "@/db";
import { userSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const MAX_INSTRUCTIONS_LENGTH = 4000;

/** The user's saved Claude Instructions, or "" if they haven't set any. */
export const getClaudeInstructions = async (
  userId: string,
): Promise<string> => {
  const [row] = await db
    .select({ claudeInstructions: userSettings.claudeInstructions })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return row?.claudeInstructions ?? "";
};

/**
 * A system block carrying the user's instructions, or nothing when they're
 * empty, so an unset field leaves Claude's behavior unchanged.
 */
export const instructionsBlock = (
  instructions: string,
): { type: "text"; text: string }[] =>
  instructions.trim()
    ? [
        {
          type: "text",
          text: `The reader has saved these instructions for how you should work with them. Follow them unless they conflict with the task or its required format:\n<reader_instructions>\n${instructions.trim()}\n</reader_instructions>`,
        },
      ]
    : [];
