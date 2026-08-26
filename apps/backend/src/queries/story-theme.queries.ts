import { DEFAULT_STORY_THEME, type StoryTheme, storyThemeSchema } from '@nao/shared/story-theme';
import { eq } from 'drizzle-orm';

import s, { DBBrandingConfig } from '../db/abstractSchema';
import { db } from '../db/db';

const SINGLETON_ID = 'default';

/**
 * Read the singleton row directly rather than reusing `branding.queries`.
 *
 * That module is `@license Enterprise`; the story design system is Apache 2.0
 * per #1463, and an Apache file must not depend on a commercially-licensed one.
 * The two features share a table, not a code path.
 */
async function getConfigRow(): Promise<DBBrandingConfig | null> {
	const [row] = await db.select().from(s.brandingConfig).where(eq(s.brandingConfig.id, SINGLETON_ID)).execute();
	return row ?? null;
}

export type StoryThemeSourceKind = 'url' | 'manual';

export interface StoryThemeState {
	/** Published theme, or null when the workspace has never published one. */
	published: StoryTheme | null;
	/** Inferred theme awaiting admin review. */
	draft: StoryTheme | null;
	source: string | null;
	sourceKind: StoryThemeSourceKind | null;
	/** What the contrast guard changed while producing the draft. */
	notes: string[];
	/** Whether published themes are actually applied to stories. */
	enabled: boolean;
}

export const EMPTY_STORY_THEME_STATE: StoryThemeState = {
	published: null,
	draft: null,
	source: null,
	sourceKind: null,
	notes: [],
	enabled: false,
};

export async function getStoryThemeState(): Promise<StoryThemeState> {
	const row = await getConfigRow();
	if (!row) {
		return EMPTY_STORY_THEME_STATE;
	}
	return {
		published: parseTheme(row.storyTheme),
		draft: parseTheme(row.storyThemeDraft),
		source: row.storyThemeSource ?? null,
		sourceKind: (row.storyThemeSourceKind as StoryThemeSourceKind | null) ?? null,
		notes: parseNotes(row.storyThemeNotes),
		enabled: Boolean(row.storyThemeEnabled),
	};
}

export interface SaveDraftInput {
	theme: StoryTheme;
	source: string | null;
	sourceKind: StoryThemeSourceKind;
	notes: string[];
}

export async function saveStoryThemeDraft(input: SaveDraftInput): Promise<void> {
	await upsert({
		storyThemeDraft: JSON.stringify(input.theme),
		storyThemeSource: input.source,
		storyThemeSourceKind: input.sourceKind,
		storyThemeNotes: JSON.stringify(input.notes),
	});
}

/**
 * Promote the draft to published and turn the feature on. Clearing the draft on
 * publish is what makes "there is something to review" a single boolean on the
 * admin screen rather than a comparison.
 */
export async function publishStoryTheme(theme: StoryTheme): Promise<void> {
	await upsert({
		storyTheme: JSON.stringify(theme),
		storyThemeDraft: null,
		storyThemeEnabled: true,
	});
}

export async function setStoryThemeEnabled(enabled: boolean): Promise<void> {
	await upsert({ storyThemeEnabled: enabled });
}

/** Drop everything and fall back to the nao look. */
export async function resetStoryTheme(): Promise<void> {
	await upsert({
		storyTheme: null,
		storyThemeDraft: null,
		storyThemeSource: null,
		storyThemeSourceKind: null,
		storyThemeNotes: null,
		storyThemeEnabled: false,
	});
}

async function upsert(partial: Record<string, unknown>): Promise<void> {
	await db
		.insert(s.brandingConfig)
		.values({ id: SINGLETON_ID, ...partial })
		.onConflictDoUpdate({
			target: s.brandingConfig.id,
			set: { ...partial, updatedAt: new Date() },
		})
		.execute();
}

/**
 * A stored theme is only as trustworthy as the code that wrote it. Parsing
 * through the schema means a row written by an older build, or hand-edited,
 * degrades to the default instead of rendering a broken story.
 */
function parseTheme(raw: string | null | undefined): StoryTheme | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed = storyThemeSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : DEFAULT_STORY_THEME;
	} catch {
		return null;
	}
}

function parseNotes(raw: string | null | undefined): string[] {
	if (!raw) {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
	} catch {
		return [];
	}
}

export async function clearStoryThemeForTesting(): Promise<void> {
	await db.delete(s.brandingConfig).where(eq(s.brandingConfig.id, SINGLETON_ID)).execute();
}
