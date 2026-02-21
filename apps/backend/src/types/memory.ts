import { DBMemory } from '../db/abstractSchema';
import { MemoryCategory } from '../utils/memory';
import { LlmProvider } from './llm';

export interface UserMemory {
	category: MemoryCategory;
	content: string;
}

export interface MemoryExtractionOptions {
	userId: string;
	projectId: string;
	chatId: string;
	userMessage: string;
	provider: LlmProvider;
}

export type UserMemoryRecord = Omit<DBMemory, 'userId' | 'chatId'>;
