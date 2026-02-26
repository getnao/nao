import { LanguageModelUsage } from 'ai';

import { MemoryExtractorLLM } from '../agents/memory/memory-extractor-llm';
import { LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import { DBMemory, DBNewMemory } from '../db/abstractSchema';
import * as llmInferenceQueries from '../queries/llm-inference';
import * as memoryQueries from '../queries/memory';
import { LlmProvider } from '../types/llm';
import type {
	ExtractorLLMOutput,
	MemoryCategory,
	MemoryExtractionOptions,
	UserInstruction,
	UserMemory,
	UserProfile,
} from '../types/memory';
import { convertToTokenUsage } from '../utils/ai';
import { resolveProviderModel } from '../utils/llm';

/**
 * Manages persistent user memories: injecting them into agent context and
 * triggering background extraction after each user message.
 */
class MemoryService {
	/** Safely gets active memories for a user to be injected into the system prompt. */
	public async safeGetUserMemories(userId: string, projectId: string, excludeChatId?: string): Promise<UserMemory[]> {
		try {
			const isEnabled = await this._isMemoryEnabled(userId, projectId);
			if (!isEnabled) {
				return [];
			}
			const memories = await memoryQueries.getUserMemories(userId, excludeChatId);
			return memories.map((memory) => ({
				category: memory.category,
				content: memory.content,
			}));
		} catch (err) {
			console.error('[memory] injection failed:', err);
			return [];
		}
	}

	/** Safely schedules memory extraction for a user message. */
	public safeScheduleMemoryExtraction(opts: MemoryExtractionOptions): void {
		this._extractMemory(opts).catch((err) => {
			console.error('[memory] extractor failed:', err);
		});
	}

	private async _extractMemory(opts: MemoryExtractionOptions): Promise<void> {
		const isEnabled = await this._isMemoryEnabled(opts.userId, opts.projectId);
		if (!isEnabled) {
			return;
		}

		const modelId = this._getExtractorModelId(opts.provider);
		const model = await this._resolveModel(opts.projectId, opts.provider, modelId);
		if (!model) {
			return;
		}

		const existingMemories = await memoryQueries.getUserMemories(opts.userId);
		const extractor = new MemoryExtractorLLM(model);
		const extractorResult = await extractor.extract(existingMemories, opts.messages);
		if (!extractorResult) {
			return;
		}

		await this._persistExtractedMemories({
			userId: opts.userId,
			chatId: opts.chatId,
			existingMemories,
			extractedMemories: extractorResult.output,
		});

		await this._saveInferenceRecord({
			projectId: opts.projectId,
			userId: opts.userId,
			chatId: opts.chatId,
			provider: opts.provider,
			modelId,
			usage: extractorResult.usage,
		});
	}

	private async _resolveModel(
		projectId: string,
		provider: LlmProvider,
		modelId: string,
	): Promise<ProviderModelResult | null> {
		return resolveProviderModel(projectId, provider, modelId);
	}

	private _getExtractorModelId(provider: LlmProvider): string {
		const providerConfig = LLM_PROVIDERS[provider];
		return providerConfig.extractorModelId;
	}

	private async _persistExtractedMemories(opts: {
		userId: string;
		chatId: string;
		existingMemories: DBMemory[];
		extractedMemories: ExtractorLLMOutput;
	}): Promise<void> {
		const existingIds = new Set(opts.existingMemories.map((m) => m.id));
		const instructions = opts.extractedMemories.user_instructions ?? [];
		const profile = opts.extractedMemories.user_profile ?? [];

		const newDbMemories = [
			...this._toDbMemories(instructions, 'global_rule', opts.userId, opts.chatId),
			...this._toDbMemories(profile, 'personal_fact', opts.userId, opts.chatId),
		].filter(({ supersedesId }) => (supersedesId ? existingIds.has(supersedesId) : true));

		if (newDbMemories.length) {
			await memoryQueries.upsertAndSupersedeMemories(newDbMemories);
		}
	}

	private _toDbMemories(
		items: (UserInstruction | UserProfile)[],
		category: MemoryCategory,
		userId: string,
		chatId: string,
	): (DBNewMemory & { supersedesId?: string | null })[] {
		return items
			.map((item) => {
				const content = this.normalizeMemoryContent(item.content);
				if (!content) {
					return;
				}
				return {
					userId,
					content,
					category,
					chatId,
					supersedesId: item.supersedes_id,
				};
			})
			.filter((m) => m !== undefined);
	}

	public normalizeMemoryContent(content: string): string {
		const normalized = content.trim().replace(/\s+/g, ' ');
		if (normalized.length === 0) {
			return normalized;
		}
		return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
	}

	private async _saveInferenceRecord(opts: {
		projectId: string;
		userId: string;
		chatId: string;
		provider: LlmProvider;
		modelId: string;
		usage: LanguageModelUsage;
	}): Promise<void> {
		const tokenUsage = convertToTokenUsage(opts.usage);
		if (!tokenUsage.totalTokens) {
			return;
		}
		await llmInferenceQueries.insertLlmInference({
			projectId: opts.projectId,
			userId: opts.userId,
			chatId: opts.chatId,
			type: 'memory_extraction',
			llmProvider: opts.provider,
			llmModelId: opts.modelId,
			...tokenUsage,
		});
	}

	private async _isMemoryEnabled(userId: string, projectId: string): Promise<boolean> {
		return memoryQueries.getIsMemoryEnabledForUserAndProject(userId, projectId);
	}
}

export const memoryService = new MemoryService();
