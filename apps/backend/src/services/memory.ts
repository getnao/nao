import { generateText, ModelMessage, Output } from 'ai';
import { z } from 'zod/v4';

import { createProviderModel, LLM_PROVIDERS } from '../agents/providers';
import { DBMemory, DBNewMemory } from '../db/abstractSchema';
import { renderToMarkdown, XML } from '../lib/markdown';
import * as memoryQueries from '../queries/memory';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { LlmProvider } from '../types/llm';
import { MemoryExtractionOptions, UserMemory } from '../types/memory';
import { getEnvApiKey } from '../utils/llm';
import { MEMORY_CATEGORIES } from '../utils/memory';

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

	/** Normalizes memory content for persistence and user edits. */
	public normalizeMemoryContent(content: string): string {
		return this._normalizeMemoryContent(content);
	}

	private async _extractMemory(opts: MemoryExtractionOptions): Promise<void> {
		const userMessage = opts.userMessage.trim();
		if (!userMessage || userMessage.length < 6) {
			return;
		}

		const isEnabled = await this._isMemoryEnabled(opts.userId, opts.projectId);
		if (!isEnabled) {
			return;
		}

		const modelId = this._getExtractorModelId(opts.provider);
		const model = await this._resolveModel(opts.projectId, opts.provider, modelId);
		if (!model) {
			return;
		}

		const existingMemories = await memoryQueries.getUserMemories(opts.userId, opts.chatId);
		const extractor = new MemoryExtractorLLM(model);
		const updated = await extractor.extract(existingMemories, userMessage);

		await this._processNewMemories({
			userId: opts.userId,
			chatId: opts.chatId,
			previousMemories: existingMemories,
			newMemories: updated,
		});
	}

	private async _resolveModel(
		projectId: string,
		provider: LlmProvider,
		modelId: string,
	): Promise<ReturnType<typeof createProviderModel> | null> {
		const config = await llmConfigQueries.getProjectLlmConfigByProvider(projectId, provider);
		if (config) {
			return createProviderModel(
				provider,
				{
					apiKey: config.apiKey,
					...(config.baseUrl && { baseURL: config.baseUrl }),
				},
				modelId,
			);
		}

		const envApiKey = getEnvApiKey(provider);
		if (envApiKey) {
			return createProviderModel(provider, { apiKey: envApiKey }, modelId);
		}

		return null;
	}

	private _getExtractorModelId(provider: LlmProvider): string {
		const providerConfig = LLM_PROVIDERS[provider];
		return providerConfig.extractorModelId;
	}

	/** Processes new memories by deleting dropped ones and upserting the new ones. */
	private async _processNewMemories(opts: {
		userId: string;
		chatId: string;
		previousMemories: DBMemory[];
		newMemories: Memory[];
	}): Promise<void> {
		const previousIds = new Set(opts.previousMemories.map((m) => m.id));
		const newIds = new Set(opts.newMemories.filter((m) => m.id).map((m) => m.id!));

		const toDeleteIds = Array.from(previousIds).filter((id) => !newIds.has(id));
		await memoryQueries.deleteMemories(toDeleteIds);

		const memoriesToUpsert: DBNewMemory[] = opts.newMemories.flatMap((memory) => {
			const content = this._normalizeMemoryContent(memory.content);
			if (!content) {
				return [];
			}

			const id = memory.id && previousIds.has(memory.id) ? memory.id : undefined;
			return [{ id, userId: opts.userId, content, category: memory.category, chatId: opts.chatId }];
		});

		await memoryQueries.upsertMemories(memoriesToUpsert);
	}

	private _normalizeMemoryContent(content: string): string {
		const normalized = content.trim().replace(/\s+/g, ' ');
		if (normalized.length === 0) {
			return normalized;
		}
		return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
	}

	private async _isMemoryEnabled(userId: string, projectId: string): Promise<boolean> {
		return memoryQueries.getIsMemoryEnabledForUserAndProject(userId, projectId);
	}
}

const MemorySchema = z.object({
	id: z.string().nullable().describe('The id of the memory. Provide `null` for new memories.'),
	content: z.string().min(1).describe('The content of the memory.'),
	category: z.enum(MEMORY_CATEGORIES).describe('The category of the memory.'),
});

type Memory = z.infer<typeof MemorySchema>;

const EXTRACTOR_SYSTEM_PROMPT = `You are a memory extractor assistant. You will be given a list of memories and a user message, and you will need to extract the new memories from the user message.

You will receive the user's current memory list (may be empty), wrapped in a <memories> tag and a recent conversation turn.

Return the complete, updated memory list. For each memory you can:
- Keep it unchanged — include it with its original id
- Update its content — include it with its original id and the new content
- Delete it — omit it from the returned list
- Add a new one — include it and provide \`null\` for the id field
- Merge two related memories into one — keep one id, drop the other, combine their content

Write each memory as a direct instruction to the agent, not as a fact about the user.
Good: "Always respond in French."
Bad: "The user wants responses in French."

Only retain or add memories that:
- The user stated explicitly (not inferred from behavior)
- Apply globally across all future conversations
- Would meaningfully change how the agent should behave

Do NOT include:
- Task-specific details (what they are working on right now)
- Questions the user asked
- Emotional reactions or pleasantries
- Anything only relevant to this conversation
- Instructions that are only relevant to a specific case
- Facts about the user that are too specific or not important enough.

Merge memories whenever they clearly overlap or are redundant — prefer fewer, broader directives over many narrow ones. For example, if two memories both concern response language, combine them into a single instruction.

If nothing meaningful changed, return the existing memories unchanged.`;

/**
 * Sends existing memories and a new conversation turn to an LLM and returns
 * the full reconciled memory list (additions, updates, deletions, merges).
 */
class MemoryExtractorLLM {
	constructor(private readonly model: ReturnType<typeof createProviderModel>) {}

	async extract(memories: DBMemory[], userMessage: string): Promise<Memory[]> {
		const { output } = await generateText({
			...this.model,
			output: Output.array({ element: MemorySchema }),
			messages: this._buildMessages(memories, userMessage),
			maxOutputTokens: 4000,
		});
		return output;
	}

	private _buildMessages(existingMemories: DBMemory[], userMessage: string): ModelMessage[] {
		return [
			{ role: 'system', content: EXTRACTOR_SYSTEM_PROMPT },
			{
				role: 'user',
				content: [
					{ type: 'text', text: this._formatMemoriesContext(existingMemories) },
					{ type: 'text', text: userMessage },
				],
			},
		];
	}

	private _formatMemoriesContext(memories: DBMemory[]): string {
		return renderToMarkdown(
			XML({
				tag: 'memories',
				props: undefined,
				children: memories.map((m) => `[id: ${m.id}] [${m.category}] ${m.content}`).join('\n'),
			}),
		);
	}
}

export const memoryService = new MemoryService();
