export const SKILL_MENTION_TRIGGER = '/';
export const DATABASE_MENTION_TRIGGER = '@';
export const STORY_REFERENCE_MENTION_TRIGGER = DATABASE_MENTION_TRIGGER;
/** Marks a cited story element in a message: `❝[n]` stands for the message's n-th citation. */
export const CITATION_MENTION_TRIGGER = '❝';
export const SHARED_WITH_ME_FOLDER_ID = '__shared_with_me__';

const STORY_REFERENCE_PREFIX = 'story:';
const STORY_REFERENCE_TOKEN = mentionToken(STORY_REFERENCE_PREFIX);
const STORY_FOLDER_REFERENCE_PREFIX = 'story-folder:';
const STORY_FOLDER_REFERENCE_TOKEN = mentionToken(STORY_FOLDER_REFERENCE_PREFIX);
const STORY_OR_FOLDER_REFERENCE_TOKEN = new RegExp(
	`@\\[(${STORY_FOLDER_REFERENCE_PREFIX}|${STORY_REFERENCE_PREFIX})([^\\]\\s]+)\\]`,
	'g',
);
const SCHEMA_REFERENCE_PREFIX = 'schema:';

export function toStoryReferenceMentionId(storyId: string): string {
	return `${STORY_REFERENCE_PREFIX}${storyId}`;
}

export function isStoryReferenceMentionId(mentionId: string): boolean {
	return mentionId.startsWith(STORY_REFERENCE_PREFIX);
}

export function getStoryIdFromMentionId(mentionId: string): string | null {
	return isStoryReferenceMentionId(mentionId) ? mentionId.slice(STORY_REFERENCE_PREFIX.length) : null;
}

/** Ids of the stories a message references with `@[story:<id>]`, in order of first appearance. */
export function extractStoryReferenceIds(text: string): string[] {
	return extractTokenIds(text, STORY_REFERENCE_TOKEN);
}

export function replaceStoryAndFolderReferences(
	text: string,
	replace: { story: (storyId: string) => string; folder: (folderId: string) => string },
): string {
	return text.replace(STORY_OR_FOLDER_REFERENCE_TOKEN, (_token, prefix: string, id: string) =>
		prefix === STORY_FOLDER_REFERENCE_PREFIX ? replace.folder(id) : replace.story(id),
	);
}

/** A story folder mention references every story inside the folder and its subfolders. */
export function toStoryFolderMentionId(folderId: string): string {
	return `${STORY_FOLDER_REFERENCE_PREFIX}${folderId}`;
}

export function isStoryFolderMentionId(mentionId: string): boolean {
	return mentionId.startsWith(STORY_FOLDER_REFERENCE_PREFIX);
}

export function extractStoryFolderReferenceIds(text: string): string[] {
	return extractTokenIds(text, STORY_FOLDER_REFERENCE_TOKEN);
}

/** A schema mention references every table of the schema. */
export function toSchemaMentionId(database: string, schema: string): string {
	return `${SCHEMA_REFERENCE_PREFIX}${database}.${schema}`;
}

export function isSchemaMentionId(mentionId: string): boolean {
	return mentionId.startsWith(SCHEMA_REFERENCE_PREFIX);
}

/** The `database.schema` key of a schema mention. */
export function getSchemaKeyFromMentionId(mentionId: string): string | null {
	return isSchemaMentionId(mentionId) ? mentionId.slice(SCHEMA_REFERENCE_PREFIX.length) : null;
}

/** Matches `@[<prefix><id>]` in a message, capturing the id. */
function mentionToken(prefix: string): RegExp {
	return new RegExp(`@\\[${prefix}([^\\]\\s]+)\\]`, 'g');
}

function extractTokenIds(text: string, token: RegExp): string[] {
	return [...new Set([...text.matchAll(token)].map((match) => match[1]))];
}
