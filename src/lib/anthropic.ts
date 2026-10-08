import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic();

export const CHAT_MODEL = "claude-sonnet-5-5";
export const DAILY_MESSAGE_LIMIT = 40;
export const DAILY_QUIZ_LIMIT = 10;
export const QUIZ_MODEL = "claude-sonnet-5-5";
export const DAILY_GRADE_LIMIT = 50;
export const GRADE_MODEL = "claude-haiku-5-5";
