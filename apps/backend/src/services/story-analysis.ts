import { generateText, Output } from 'ai';
import { z } from 'zod';

import { LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import * as chatQueries from '../queries/chat.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { resolveProviderModel } from '../utils/llm';

export interface AnalysisBlock {
	id: string;
	prompt: string;
}

export function parseAnalysisBlocks(code: string): AnalysisBlock[] {
	const regex = /<analysis\s+([^/>]*)\/?\s*>/g;
	const blocks: AnalysisBlock[] = [];
	let match;

	while ((match = regex.exec(code)) !== null) {
		const attrs = parseAttributes(match[1]);
		if (attrs.id) {
			blocks.push({ id: attrs.id, prompt: attrs.prompt ?? '' });
		}
	}

	return blocks;
}

export async function generateAnalyses(
	chatId: string,
	storyCode: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
): Promise<Record<string, string>> {
	const blocks = parseAnalysisBlocks(storyCode);
	if (blocks.length === 0) {
		return {};
	}

	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		return {};
	}

	const modelConfig = await resolveModelForProject(projectId);
	if (!modelConfig) {
		return {};
	}

	const prompt = buildPrompt(storyCode, blocks, queryData);
	return callLlm(modelConfig, prompt, blocks);
}

function buildPrompt(
	storyCode: string,
	blocks: AnalysisBlock[],
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
): string {
	const blocksDescription = blocks
		.map((b) => {
			const promptLine = b.prompt ? `Custom prompt: "${b.prompt}"` : 'No custom prompt (infer from context)';
			return `### ${b.id}\n${promptLine}`;
		})
		.join('\n\n');

	const dataDescription = Object.entries(queryData)
		.map(([queryId, { data, columns }]) => {
			const preview = data.slice(0, 20);
			const rows = preview.map((row) => JSON.stringify(row)).join('\n');
			return `### ${queryId}\nColumns: ${columns.join(', ')}\nTotal rows: ${data.length}\nData (first ${preview.length} rows):\n${rows}`;
		})
		.join('\n\n');

	return [
		'You are generating dynamic text analyses for a data story. The story contains <analysis> blocks that need to be filled with AI-generated markdown content based on the data.',
		'',
		'## Full story (for context)',
		'Understand the overall narrative, the position of each <analysis> block relative to charts/tables, and what kind of insight each block should provide.',
		'',
		storyCode,
		'',
		'## Analysis blocks to generate',
		'',
		blocksDescription,
		'',
		'## Available query data',
		'',
		dataDescription,
		'',
		'## Instructions',
		'- Generate markdown content for each analysis block',
		'- If a block has a custom prompt, follow it closely',
		"- If no custom prompt, infer the appropriate analysis from the block's position in the story and nearby charts/tables",
		'- Reference specific numbers, trends, and insights from the data',
		'- Keep each analysis concise and insightful (1-3 paragraphs typically)',
		'- Use markdown formatting: bold for key numbers, bullet points for lists',
		'- Do NOT include chart/table/grid/analysis tags in your output — just markdown text',
	].join('\n');
}

async function callLlm(
	modelConfig: ProviderModelResult,
	prompt: string,
	blocks: AnalysisBlock[],
): Promise<Record<string, string>> {
	const schema: Record<string, z.ZodType> = {};
	for (const block of blocks) {
		schema[block.id] = z.string().describe(`Generated analysis for block "${block.id}"`);
	}

	try {
		const { output } = await generateText({
			model: modelConfig.model,
			messages: [{ role: 'user', content: prompt }],
			output: Output.object({
				schema: z.object({
					analyses: z.object(schema).describe('Generated analysis content keyed by block id'),
				}),
			}),
			maxOutputTokens: 8_000,
		});

		return (output?.analyses as Record<string, string>) ?? {};
	} catch (err) {
		console.error('[story-analysis] LLM call failed:', err);
		return {};
	}
}

function parseAttributes(attrString: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const regex = /(\w+)=(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/g;
	let match;
	while ((match = regex.exec(attrString)) !== null) {
		attrs[match[1]] = match[2] ?? match[3] ?? '';
	}
	return attrs;
}

async function resolveModelForProject(projectId: string): Promise<ProviderModelResult | null> {
	const provider = await llmConfigQueries.getProjectModelProvider(projectId);
	if (!provider) {
		return null;
	}

	const summaryModelId = LLM_PROVIDERS[provider].summaryModelId;
	return resolveProviderModel(projectId, provider, summaryModelId);
}
