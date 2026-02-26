import { z } from 'zod/v4';

import { DBMemory } from '../db/abstractSchema';
import { UIMessage } from './chat';
import { LlmProvider } from './llm';

/** Categories of memories that can be extracted from user messages. Ordered by priority. */
export const MEMORY_CATEGORIES = ['global_rule', 'personal_fact'] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export interface UserMemory {
	category: MemoryCategory;
	content: string;
}

export interface MemoryExtractionOptions {
	userId: string;
	projectId: string;
	chatId: string;
	messages: UIMessage[];
	provider: LlmProvider;
}

export type UserMemoryRecord = Omit<DBMemory, 'userId' | 'chatId'>;

export type UserInstruction = z.infer<typeof UserInstructionSchema>;
const UserInstructionSchema = z.object({
	content: z
		.string()
		.trim()
		.min(1)
		.describe(
			'The user instructions to be persisted. Must be a direct directive to the agent (e.g. "Do ...", "Do not ...", "Always ...", "Never ...", etc).',
		),
	supersedes_id: z
		.string()
		.nullable()
		.describe("The id of an existing user instruction's memory that this one supersedes."),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;
const UserProfileSchema = z.object({
	content: z
		.string()
		.trim()
		.min(1)
		.describe(
			'The user profile to be persisted. Must be a concise statement about the user (e.g. "The user\'s name is ...", "The user works as a ...").',
		),
	supersedes_id: z
		.string()
		.nullable()
		.describe("The id of an existing user profile's memory that this one supersedes."),
});

export type ExtractorLLMOutput = z.infer<typeof ExtractorOutputSchema>;
export const ExtractorOutputSchema = z.object({
	user_instructions: z.array(UserInstructionSchema).nullable(),
	user_profile: z.array(UserProfileSchema).nullable(),
});
