import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic();

export const CHAT_MODEL = "claude-sonnet-5";
export const DAILY_MESSAGE_LIMIT = 40;
export const QUIZ_MODEL = "claude-sonnet-5-5";
