import type { LlmSelectedModel } from './types';

export const BACKGROUND_MODEL_CATEGORIES = [
	'live_story',
	'title',
	'compaction',
	'context_recommendation',
	'other',
] as const;

export type BackgroundModelCategory = (typeof BACKGROUND_MODEL_CATEGORIES)[number];

export const BACKGROUND_MODEL_CATEGORY_LABELS: Record<BackgroundModelCategory, string> = {
	live_story: 'Live story refresh',
	title: 'Title generation',
	compaction: 'Conversation compaction',
	context_recommendation: 'Context recommendations',
	other: 'Other tasks',
};

export const BACKGROUND_MODEL_CATEGORY_DESCRIPTIONS: Record<BackgroundModelCategory, string> = {
	live_story: 'Rewrites live story narratives when their data refreshes.',
	title: 'Names chats and automations from their first prompt.',
	compaction: 'Summarizes long conversations to keep them within the context window.',
	context_recommendation: 'Analyzes past chats to suggest context improvements.',
	other: 'Small background helpers such as natural-language schedule parsing and memory extraction.',
};

export type BackgroundModelMode = 'single' | 'perCategory';

export interface BackgroundModelSettings {
	mode: BackgroundModelMode;
	single?: LlmSelectedModel;
	categories?: Partial<Record<BackgroundModelCategory, LlmSelectedModel>>;
}

export function selectBackgroundModel(
	settings: BackgroundModelSettings | null | undefined,
	category: BackgroundModelCategory,
): LlmSelectedModel | null {
	if (!settings) {
		return null;
	}
	if (settings.mode === 'single') {
		return settings.single ?? null;
	}
	return settings.categories?.[category] ?? null;
}

export function isSameModel(a: LlmSelectedModel | null | undefined, b: LlmSelectedModel | null | undefined): boolean {
	return !!a && !!b && a.provider === b.provider && a.modelId === b.modelId;
}
