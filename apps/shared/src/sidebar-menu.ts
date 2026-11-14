import { z } from 'zod';

import { STORY_FORMATS } from './types';

export const BUILT_IN_MENU_ENTRY_IDS = ['new-chat', 'search-chats', 'stories', 'inbox', 'automations'] as const;
export type BuiltInMenuEntryId = (typeof BUILT_IN_MENU_ENTRY_IDS)[number];

export const BUILT_IN_MENU_ENTRY_LABELS: Record<BuiltInMenuEntryId, string> = {
	'new-chat': 'New chat',
	'search-chats': 'Search chats',
	stories: 'Stories',
	inbox: 'Inbox',
	automations: 'Automations',
};

export const MAX_CUSTOM_MENU_ENTRIES = 30;
export const MAX_MENU_ENTRY_LABEL_LENGTH = 40;

const labelSchema = z.string().trim().min(1).max(MAX_MENU_ENTRY_LABEL_LENGTH);
/** A Lucide icon name such as `layout-grid`; null keeps the entry's default icon. */
const iconSchema = z
	.string()
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
	.max(64)
	.nullable()
	.default(null);
const customEntryIdSchema = z
	.string()
	.min(1)
	.max(64)
	.refine((id) => !isBuiltInMenuEntryId(id), 'Custom entries cannot reuse a built-in entry id.');

export const storiesPageFiltersSchema = z.object({
	folderId: z.string().min(1).nullable(),
	format: z.enum(['any', ...STORY_FORMATS]),
	certifiedOnly: z.boolean(),
	liveOnly: z.boolean(),
	owner: z.enum(['anyone', 'me', 'others']),
});

const builtInEntrySchema = z.object({
	type: z.literal('built-in'),
	id: z.enum(BUILT_IN_MENU_ENTRY_IDS),
	label: labelSchema.nullable(),
	icon: iconSchema,
	hidden: z.boolean(),
});

const storyEntrySchema = z.object({
	type: z.literal('story'),
	id: customEntryIdSchema,
	label: labelSchema,
	icon: iconSchema,
	storyId: z.string().min(1),
});

const storiesPageEntrySchema = z.object({
	type: z.literal('stories-page'),
	id: customEntryIdSchema,
	label: labelSchema,
	icon: iconSchema,
	filters: storiesPageFiltersSchema,
});

const linkEntrySchema = z.object({
	type: z.literal('link'),
	id: customEntryIdSchema,
	label: labelSchema,
	icon: iconSchema,
	url: z.url({ protocol: /^https?$/, normalize: true }),
});

export const sidebarMenuEntrySchema = z.discriminatedUnion('type', [
	builtInEntrySchema,
	storyEntrySchema,
	storiesPageEntrySchema,
	linkEntrySchema,
]);

export const sidebarMenuSchema = z.object({
	entries: z
		.array(sidebarMenuEntrySchema)
		.refine(
			(entries) => countCustomMenuEntries(entries) <= MAX_CUSTOM_MENU_ENTRIES,
			`A menu holds at most ${MAX_CUSTOM_MENU_ENTRIES} custom entries.`,
		)
		.refine(
			(entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
			'Entry ids must be unique.',
		),
});

export type StoriesPageFilters = z.infer<typeof storiesPageFiltersSchema>;
export type SidebarMenuEntry = z.infer<typeof sidebarMenuEntrySchema>;
export type BuiltInMenuEntry = z.infer<typeof builtInEntrySchema>;
export type CustomMenuEntry = Exclude<SidebarMenuEntry, BuiltInMenuEntry>;
export type SidebarMenu = z.infer<typeof sidebarMenuSchema>;

export const DEFAULT_STORIES_PAGE_FILTERS: StoriesPageFilters = {
	folderId: null,
	format: 'any',
	certifiedOnly: false,
	liveOnly: false,
	owner: 'anyone',
};

/**
 * Keeps the stored order and appends any built-in entry missing from it, so a
 * menu saved before a built-in entry existed still shows that entry.
 */
export function resolveSidebarMenu(menu: SidebarMenu | null | undefined): SidebarMenuEntry[] {
	const entries = parseStoredEntries(menu);
	const presentIds = new Set(entries.map((entry) => entry.id));
	const missingBuiltIns = BUILT_IN_MENU_ENTRY_IDS.filter((id) => !presentIds.has(id)).map(createBuiltInEntry);
	return [...entries, ...missingBuiltIns];
}

export function getMenuEntryLabel(entry: SidebarMenuEntry): string {
	if (entry.type === 'built-in') {
		return entry.label ?? BUILT_IN_MENU_ENTRY_LABELS[entry.id];
	}
	return entry.label;
}

/** Only custom entries count towards the limit, so a full menu still saves once a new built-in entry is appended. */
export function countCustomMenuEntries(entries: readonly SidebarMenuEntry[]): number {
	return entries.filter((entry) => entry.type !== 'built-in').length;
}

export function isBuiltInMenuEntryId(id: string): id is BuiltInMenuEntryId {
	return (BUILT_IN_MENU_ENTRY_IDS as readonly string[]).includes(id);
}

function createBuiltInEntry(id: BuiltInMenuEntryId): BuiltInMenuEntry {
	return { type: 'built-in', id, label: null, icon: null, hidden: false };
}

/** Drops entries a newer or older build cannot read instead of failing the whole menu. */
function parseStoredEntries(menu: SidebarMenu | null | undefined): SidebarMenuEntry[] {
	const seenIds = new Set<string>();
	const entries: SidebarMenuEntry[] = [];
	for (const candidate of menu?.entries ?? []) {
		const parsed = sidebarMenuEntrySchema.safeParse(candidate);
		if (parsed.success && !seenIds.has(parsed.data.id)) {
			seenIds.add(parsed.data.id);
			entries.push(parsed.data);
		}
	}
	return entries;
}
