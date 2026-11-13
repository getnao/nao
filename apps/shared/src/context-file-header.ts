import { type Document, isMap, parseDocument, stringify } from 'yaml';

import { isRootRulesPath } from './rules-template';

/**
 * The YAML frontmatter of a Markdown context file. Next to the `type` that `nao sync` writes on the files it generates,
 * it describes the file with a title, a description, the email of the user who owns it and tags.
 */
export interface ContextFileHeader {
	title: string | null;
	description: string | null;
	owner: string | null;
	tags: string[];
}

export type ContextFileHeaderField = keyof ContextFileHeader;

export type ContextFileHeaderChanges = Partial<ContextFileHeader>;

export type ContextFileHeaderProblem =
	| { kind: 'invalid-header'; message: string }
	| { kind: 'invalid-field'; field: string; message: string }
	| { kind: 'unknown-property'; property: string; message: string }
	| { kind: 'unknown-owner'; owner: string; message: string };

export interface ContextFileHeaderReading {
	header: ContextFileHeader;
	hasHeader: boolean;
	/** Every property the header sets, the ones nao does not know included. */
	properties: string[];
	isGenerated: boolean;
	problems: ContextFileHeaderProblem[];
}

export interface ContextFileHeaderValidationOptions {
	filePath: string;
	/** The lowercased emails of the users of the project; the owner is not checked without them. */
	userEmails?: ReadonlySet<string>;
}

export interface ContextFileHeaderProblems {
	path: string;
	problems: ContextFileHeaderProblem[];
}

/** A user of the project, who can own context files. */
export interface ContextFileOwner {
	id: string;
	name: string;
	email: string;
}

const KNOWN_PROPERTIES = new Set(['title', 'description', 'owner', 'tags', 'type', 'comment']);
const FILE_TYPES = new Set(['generated', 'manual']);
/** Folders whose files `nao sync` writes with the properties of their source, like a Notion page id. */
const SYNCED_SOURCE_FOLDERS = ['repos/', 'docs/notion/', 'docs/confluence/', 'docs/obsidian/'];
/** The folder of the agent skills, whose header names each skill with `name`. */
const SKILLS_FOLDER = 'agent/skills/';
const SKILL_FILE_NAME = 'SKILL.md';
const SKILL_NAME_PROPERTY = 'name';
const ROOT_RULES_DESCRIPTION =
	'The main rules of the agent, read at the start of every conversation. They orchestrate the whole context, telling the agent how to work and which files to read for each topic.';
const FILE_EXTENSION_PATTERN = /\.[^.]+$/;
const FRONTMATTER_PATTERN = /^(\uFEFF?)---(\r?\n)(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)\r?(?:\n|$)/;

export function readContextFileHeader(content: string): ContextFileHeaderReading {
	const { yaml } = splitFrontmatter(content);
	if (yaml === null) {
		return emptyReading(false, []);
	}
	const document = parseDocument(yaml);
	if (document.errors.length > 0) {
		return emptyReading(true, [invalidHeader(`It is not valid YAML: ${firstLine(document.errors[0].message)}`)]);
	}
	const data: unknown = document.toJS();
	if (data === null || data === undefined) {
		return emptyReading(true, []);
	}
	if (!isRecord(data)) {
		return emptyReading(true, [invalidHeader('It must hold `key: value` properties.')]);
	}
	return readHeaderFields(data);
}

/**
 * Every problem of the header: what cannot be read, a property nao does not know on a file people write, and an owner
 * who is not a user of the project.
 */
export function validateContextFileHeader(
	content: string,
	{ filePath, userEmails }: ContextFileHeaderValidationOptions,
): ContextFileHeaderProblem[] {
	const reading = readContextFileHeader(content);
	return [
		...reading.problems,
		...findUnknownProperties(reading, filePath),
		...findUnknownOwner(reading.header, userEmails),
	];
}

export function isContextFileHeaderEditable(reading: ContextFileHeaderReading): boolean {
	return reading.problems.every((problem) => problem.kind !== 'invalid-header');
}

/**
 * The title and description a file has until its header sets them: the title comes from the file name, and the root
 * RULES.md is described as the orchestrator of the context.
 */
export function getDefaultContextFileHeader(filePath: string): Pick<ContextFileHeader, 'title' | 'description'> {
	return {
		title: titleFromFileName(filePath),
		description: isRootRulesPath(filePath) ? ROOT_RULES_DESCRIPTION : null,
	};
}

/** Starts a header showing every property, filled with the defaults of the file, for the user to complete. */
export function addContextFileHeader(
	content: string,
	defaults: Pick<ContextFileHeader, 'title' | 'description'>,
): string {
	const { bom, lineBreak, yaml, body } = splitFrontmatter(content);
	if (yaml !== null) {
		return content;
	}
	const properties = [
		`title: ${toYamlScalar(defaults.title)}`,
		`description: ${toYamlScalar(defaults.description)}`,
		'owner: ',
		'tags: []',
	].map((line) => line.trimEnd());
	const separator = body ? lineBreak : '';
	return `${bom}---${lineBreak}${properties.join(lineBreak)}${lineBreak}---${lineBreak}${separator}${body}`;
}

/**
 * Writes the changed fields into the frontmatter, keeping its other properties and comments and the body untouched. An
 * empty value removes its property, and the frontmatter goes away once it holds nothing.
 */
export function updateContextFileHeader(content: string, changes: ContextFileHeaderChanges): string {
	const reading = readContextFileHeader(content);
	if (!isContextFileHeaderEditable(reading)) {
		throw new Error('The header of this file is not valid YAML.');
	}
	if (isUnchanged(reading.header, changes)) {
		return content;
	}
	const { bom, lineBreak, yaml, body } = splitFrontmatter(content);
	const document = parseDocument(yaml ?? '');
	applyChanges(document, changes);
	if (isMap(document.contents) && document.contents.items.length === 0) {
		return bom + (yaml === null ? body : body.replace(/^\r?\n/, ''));
	}
	const properties = document
		.toString({ lineWidth: 0, flowCollectionPadding: false })
		.replaceAll(/\r?\n/g, lineBreak);
	const separator = yaml === null && body ? lineBreak : '';
	return `${bom}---${lineBreak}${properties}---${lineBreak}${separator}${body}`;
}

export function normalizeContextFileTags(tags: string[]): string[] {
	const normalized = tags.map((tag) => tag.trim()).filter(Boolean);
	return [...new Set(normalized)];
}

function emptyReading(hasHeader: boolean, problems: ContextFileHeaderProblem[]): ContextFileHeaderReading {
	return {
		header: { title: null, description: null, owner: null, tags: [] },
		hasHeader,
		properties: [],
		isGenerated: false,
		problems,
	};
}

function readHeaderFields(data: Record<string, unknown>): ContextFileHeaderReading {
	const problems: ContextFileHeaderProblem[] = [];
	if (data.type !== undefined && data.type !== null && !FILE_TYPES.has(String(data.type))) {
		problems.push(invalidField('type', 'The type must be generated or manual.'));
	}
	const readText = (field: Exclude<ContextFileHeaderField, 'tags'>): string | null => {
		const value = toText(data[field]);
		if (value === undefined) {
			problems.push(invalidField(field, `The ${field} must be text.`));
			return null;
		}
		return value;
	};
	const header: ContextFileHeader = {
		title: readText('title'),
		description: readText('description'),
		owner: readText('owner'),
		tags: readTags(data.tags, problems),
	};
	return { header, hasHeader: true, properties: Object.keys(data), isGenerated: data.type === 'generated', problems };
}

function findUnknownProperties(reading: ContextFileHeaderReading, filePath: string): ContextFileHeaderProblem[] {
	const projectPath = toProjectPath(filePath);
	if (reading.isGenerated || isSyncedSourcePath(projectPath)) {
		return [];
	}
	const isSkill = isSkillPath(projectPath);
	return reading.properties
		.filter((property) => !KNOWN_PROPERTIES.has(property) && !(isSkill && property === SKILL_NAME_PROPERTY))
		.map((property) => unknownProperty(property, isSkill));
}

function findUnknownOwner(header: ContextFileHeader, userEmails?: ReadonlySet<string>): ContextFileHeaderProblem[] {
	if (!header.owner || !userEmails || userEmails.has(header.owner.toLowerCase())) {
		return [];
	}
	return [unknownOwner(header.owner)];
}

function toProjectPath(filePath: string): string {
	return filePath.replaceAll('\\', '/').replace(/^\.?\/+/, '');
}

function isSyncedSourcePath(projectPath: string): boolean {
	return SYNCED_SOURCE_FOLDERS.some((folder) => projectPath.startsWith(folder));
}

function isSkillPath(projectPath: string): boolean {
	return projectPath.startsWith(SKILLS_FOLDER) || projectPath.split('/').pop() === SKILL_FILE_NAME;
}

function toYamlScalar(value: string | null): string {
	return value ? stringify(value, { lineWidth: 0 }).trim() : '';
}

function readTags(value: unknown, problems: ContextFileHeaderProblem[]): string[] {
	if (value === null || value === undefined) {
		return [];
	}
	if (typeof value === 'string') {
		return normalizeContextFileTags(value.split(','));
	}
	const tags = Array.isArray(value) ? value.map(toText) : [undefined];
	if (tags.some((tag) => tag === undefined)) {
		problems.push(invalidField('tags', 'The tags must be a list of text values.'));
		return [];
	}
	return normalizeContextFileTags(tags.filter((tag): tag is string => tag !== null));
}

/** The value as trimmed text, null when empty, or undefined when it is not a scalar. */
function toText(value: unknown): string | null | undefined {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return String(value).trim() || null;
	}
	if (value instanceof Date) {
		return value.toISOString().slice(0, 10);
	}
	return undefined;
}

function applyChanges(document: Document, changes: ContextFileHeaderChanges): void {
	if (!isMap(document.contents)) {
		document.contents = document.createNode({});
	}
	for (const [field, value] of Object.entries(changes) as [ContextFileHeaderField, string | string[] | null][]) {
		if (Array.isArray(value)) {
			setTags(document, normalizeContextFileTags(value));
		} else if (value?.trim()) {
			document.set(field, value.trim());
		} else {
			document.delete(field);
		}
	}
}

function setTags(document: Document, tags: string[]): void {
	if (tags.length === 0) {
		document.delete('tags');
		return;
	}
	const node = document.createNode(tags);
	node.flow = true;
	document.set('tags', node);
}

function isUnchanged(header: ContextFileHeader, changes: ContextFileHeaderChanges): boolean {
	return (Object.entries(changes) as [ContextFileHeaderField, string | string[] | null][]).every(([field, value]) => {
		if (Array.isArray(value)) {
			return normalizeContextFileTags(value).join('\n') === header.tags.join('\n');
		}
		return (value?.trim() || null) === header[field];
	});
}

function splitFrontmatter(content: string): { bom: string; lineBreak: string; yaml: string | null; body: string } {
	const match = FRONTMATTER_PATTERN.exec(content);
	if (!match) {
		const bom = content.startsWith('\uFEFF') ? '\uFEFF' : '';
		return {
			bom,
			lineBreak: content.includes('\r\n') ? '\r\n' : '\n',
			yaml: null,
			body: content.slice(bom.length),
		};
	}
	return { bom: match[1], lineBreak: match[2], yaml: match[3] ?? '', body: content.slice(match[0].length) };
}

/** The file name read as words: `revenue_by-region.md` is "Revenue by region", `RULES.md` is "Rules". */
function titleFromFileName(filePath: string): string {
	const fileName = filePath.replaceAll('\\', '/').split('/').pop() ?? filePath;
	const words = fileName.replace(FILE_EXTENSION_PATTERN, '').replaceAll(/[-_]+/g, ' ').trim();
	const sentence = words === words.toUpperCase() ? words.toLowerCase() : words;
	return sentence.charAt(0).toUpperCase() + sentence.slice(1) || fileName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstLine(message: string): string {
	return message.split('\n')[0].trim();
}

function invalidHeader(message: string): ContextFileHeaderProblem {
	return { kind: 'invalid-header', message: `The header is broken. ${message}` };
}

function invalidField(field: string, message: string): ContextFileHeaderProblem {
	return { kind: 'invalid-field', field, message };
}

function unknownOwner(owner: string): ContextFileHeaderProblem {
	return { kind: 'unknown-owner', owner, message: `The owner ${owner} is not a user of this project.` };
}

function unknownProperty(property: string, isSkill: boolean): ContextFileHeaderProblem {
	const properties = isSkill ? 'name, title, description, owner and tags' : 'title, description, owner and tags';
	return {
		kind: 'unknown-property',
		property,
		message: `Unknown property "${property}". A ${isSkill ? 'skill ' : ''}header holds ${properties}.`,
	};
}
