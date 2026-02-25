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
