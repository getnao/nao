import { z } from 'zod';

import { MAX_THEME_INSTRUCTIONS_LENGTH } from './story-theme-source';
import { joinWithAnd, parseStoredJson } from './utils';

export const STORY_THEME_SOURCE_KINDS = [
	'website',
	'image',
	'pdf',
	'zip',
	'logo',
	'instructions',
	'white-label',
] as const;
export type StoryThemeSourceKind = (typeof STORY_THEME_SOURCE_KINDS)[number];

export const MAX_GENERATION_SOURCES = 12;
export const MAX_GENERATION_NOTES = 40;
export const MAX_GENERATION_TEXT_LENGTH = 600;
export const MAX_SOURCE_NAME_LENGTH = 300;

export const storyThemeSourceRecordSchema = z.object({
	kind: z.enum(STORY_THEME_SOURCE_KINDS),
	name: z.string().trim().max(MAX_SOURCE_NAME_LENGTH),
	detail: z.string().trim().max(200).optional(),
});

export const storyThemeGenerationSchema = z.object({
	generatedAt: z.string().datetime(),
	sources: z.array(storyThemeSourceRecordSchema).max(MAX_GENERATION_SOURCES),
	instructions: z.string().max(MAX_THEME_INSTRUCTIONS_LENGTH).optional(),
	rationale: z.string().max(MAX_GENERATION_TEXT_LENGTH).optional(),
	/** Something the admin should check before saving, such as a website that redirected to another domain. */
	alert: z.string().max(MAX_GENERATION_TEXT_LENGTH).optional(),
	notes: z.array(z.string().max(MAX_GENERATION_TEXT_LENGTH)).max(MAX_GENERATION_NOTES).default([]),
	/** True when the admin changed settings by hand between generating and saving. */
	editedByHand: z.boolean().default(false),
});

export type StoryThemeSourceRecord = z.infer<typeof storyThemeSourceRecordSchema>;
export type StoryThemeGeneration = z.infer<typeof storyThemeGenerationSchema>;

export function parseStoredStoryThemeGeneration(raw: unknown): StoryThemeGeneration | null {
	return parseStoredJson(raw, storyThemeGenerationSchema);
}

export function describeStoryThemeSources(sources: StoryThemeSourceRecord[]): string {
	return joinWithAnd(sources.map((source) => (source.kind === 'instructions' ? 'instructions' : source.name)));
}
