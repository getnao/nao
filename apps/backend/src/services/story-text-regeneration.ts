import { generateText, Output } from 'ai';
import { z } from 'zod';

import { LLM_PROVIDERS, type ProviderModelResult } from '../agents/providers';
import * as chatQueries from '../queries/chat.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import { resolveProviderModel } from '../utils/llm';

interface TextSection {
	index: number;
	content: string;
}

interface StoryTemplate {
	skeleton: string;
	textSections: TextSection[];
}

export async function regenerateStoryText(
	chatId: string,
	storyCode: string,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
): Promise<string> {
	const projectId = await chatQueries.getChatProjectId(chatId);
	if (!projectId) {
		throw new Error('Chat project not found');
	}

	const modelConfig = await resolveModelForProject(projectId);
	if (!modelConfig) {
		return storyCode;
	}

	const template = parseStoryTemplate(storyCode);
	if (template.textSections.length === 0) {
		return storyCode;
	}

	const prompt = buildRegenerationPrompt(template, queryData);
	const updatedSections = await callLlm(modelConfig, prompt, template.textSections.length);

	return assembleStory(template, updatedSections);
}

function parseStoryTemplate(code: string): StoryTemplate {
	const blockRegex = /<grid\s+[^>]*>[\s\S]*?<\/grid>|<chart\s+[^/>]*\/?>|<table\s+[^/>]*\/?>/g;
	const textSections: TextSection[] = [];
	let skeleton = '';
	let lastIndex = 0;
	let sectionIndex = 0;

	let match;
	while ((match = blockRegex.exec(code)) !== null) {
		if (match.index > lastIndex) {
			const text = code.slice(lastIndex, match.index);
			const trimmed = text.trim();
			if (trimmed) {
				textSections.push({ index: sectionIndex, content: trimmed });
				skeleton += `[TEXT_${sectionIndex}]\n\n`;
				sectionIndex++;
			}
		}
		skeleton += match[0] + '\n\n';
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < code.length) {
		const text = code.slice(lastIndex).trim();
		if (text) {
			textSections.push({ index: sectionIndex, content: text });
			skeleton += `[TEXT_${sectionIndex}]\n\n`;
		}
	}

	return { skeleton, textSections };
}

function buildRegenerationPrompt(
	template: StoryTemplate,
	queryData: Record<string, { data: unknown[]; columns: string[] }>,
): string {
	const sectionsDescription = template.textSections.map((s) => `### TEXT_${s.index}\n${s.content}`).join('\n\n');

	const dataDescription = Object.entries(queryData)
		.map(([queryId, { data, columns }]) => {
			const preview = data.slice(0, 20);
			const rows = preview.map((row) => JSON.stringify(row)).join('\n');
			const totalRows = data.length;
			return `### ${queryId}\nColumns: ${columns.join(', ')}\nTotal rows: ${totalRows}\nData (first ${preview.length} rows):\n${rows}`;
		})
		.join('\n\n');

	return [
		'You are updating the text analysis in a data story. The story has a fixed structure with charts, tables, and grids that must NOT change. You must regenerate ONLY the text sections to reflect the new data.',
		'',
		'## Story structure (skeleton)',
		'The [TEXT_N] placeholders are where your regenerated text goes. Everything else (chart/table/grid blocks) stays exactly as-is.',
		'',
		template.skeleton,
		'',
		'## Original text sections (for style and structure reference)',
		'Maintain the same writing style, heading levels, markdown formatting, tone, and general narrative purpose of each section.',
		'',
		sectionsDescription,
		'',
		'## New query data',
		'Update the text to reflect this data. Reference specific numbers, trends, and insights from the data.',
		'',
		dataDescription,
		'',
		'## Instructions',
		'- Preserve the exact heading structure (h1, h2, h3) and markdown formatting style',
		'- Update all specific numbers, percentages, and data references to match the new data',
		'- Keep the same narrative flow and analytical purpose for each section',
		'- Do NOT include any chart/table/grid blocks in your text — those are handled separately',
		'- Each text section should be roughly the same length as the original',
	].join('\n');
}

async function callLlm(
	modelConfig: ProviderModelResult,
	prompt: string,
	sectionCount: number,
): Promise<Record<string, string>> {
	const sectionSchema: Record<string, z.ZodType> = {};
	for (let i = 0; i < sectionCount; i++) {
		sectionSchema[`TEXT_${i}`] = z.string().describe(`Regenerated content for text section ${i}`);
	}

	try {
		const { output } = await generateText({
			model: modelConfig.model,
			messages: [{ role: 'user', content: prompt }],
			output: Output.object({
				schema: z.object({
					sections: z
						.object(sectionSchema)
						.describe('Regenerated text sections keyed by their placeholder name'),
				}),
			}),
			maxOutputTokens: 8_000,
		});

		return (output?.sections as Record<string, string>) ?? {};
	} catch (err) {
		console.error('[story-text-regeneration] LLM call failed:', err);
		return {};
	}
}

function assembleStory(template: StoryTemplate, updatedSections: Record<string, string>): string {
	let result = template.skeleton;

	for (const section of template.textSections) {
		const key = `TEXT_${section.index}`;
		const updatedText = updatedSections[key]?.trim();
		const replacement = updatedText || section.content;
		result = result.replace(`[${key}]`, replacement);
	}

	return result.trim();
}

async function resolveModelForProject(projectId: string): Promise<ProviderModelResult | null> {
	const provider = await llmConfigQueries.getProjectModelProvider(projectId);
	if (!provider) {
		return null;
	}

	const summaryModelId = LLM_PROVIDERS[provider].summaryModelId;
	return resolveProviderModel(projectId, provider, summaryModelId);
}
