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

export function setBackgroundModelMode(
	settings: BackgroundModelSettings | null | undefined,
	mode: BackgroundModelMode,
): BackgroundModelSettings {
	const single = settings?.single;
	const categories =
		mode === 'perCategory' && settings?.mode === 'single' && single
			? Object.fromEntries(BACKGROUND_MODEL_CATEGORIES.map((category) => [category, single]))
			: settings?.categories;

	return { mode, single, categories };
}

/**
 * Pins a model for a single category. Switching away from a single default keeps that default
 * applied to every other category, so changing one task never silently changes the rest.
 */
export function setBackgroundModelForCategory(
	settings: BackgroundModelSettings | null | undefined,
	category: BackgroundModelCategory,
	selection: LlmSelectedModel | null,
): BackgroundModelSettings {
	const single = settings?.single;
	const categories: Partial<Record<BackgroundModelCategory, LlmSelectedModel>> =
		settings?.mode === 'single' && single
			? Object.fromEntries(BACKGROUND_MODEL_CATEGORIES.map((c) => [c, single]))
			: { ...settings?.categories };

	if (selection) {
		categories[category] = selection;
	} else {
		delete categories[category];
	}

	return { mode: 'perCategory', single, categories };
}
