export type UserRulesGroupAccess = { enforced: false } | { enforced: true; groupNames: readonly string[] };

type ConditionalFrame = {
	include: boolean;
};

type Fence = {
	character: '`' | '~';
	length: number;
	containers: MarkdownContainer[];
};

export type RenderedConditionalGroupBlocks = {
	content: string;
	lines: Array<{
		content: string;
		sourceLineNumber: number;
	}>;
};

export function renderConditionalGroupBlocks(source: string, access: UserRulesGroupAccess): string {
	return renderConditionalGroupBlocksWithSourceLines(source, access).content;
}

export function renderConditionalGroupBlocksWithSourceLines(
	source: string,
	access: UserRulesGroupAccess,
): RenderedConditionalGroupBlocks {
	const renderedLines: string[] = [];
	const sourceLines: RenderedConditionalGroupBlocks['lines'] = [];
	const conditionalStack: ConditionalFrame[] = [];
	const accessibleGroupNames = access.enforced
		? new Set(access.groupNames.map((groupName) => groupName.toLowerCase()))
		: undefined;
	let fence: Fence | undefined;

	for (const [lineIndex, line] of splitLines(source).entries()) {
		const lineBody = removeLineEnding(line);
		const containerLine = parseMarkdownContainerLine(lineBody);
		const fenceMarker = parseFenceMarker(containerLine);

		if (fence) {
			if (isClosingFence(lineBody, fence)) {
				fence = undefined;
			}
			if (shouldInclude(conditionalStack)) {
				renderedLines.push(line);
				sourceLines.push({ content: lineBody, sourceLineNumber: lineIndex + 1 });
			}
			continue;
		}

		if (fenceMarker) {
			fence = fenceMarker;
			if (shouldInclude(conditionalStack)) {
				renderedLines.push(line);
				sourceLines.push({ content: lineBody, sourceLineNumber: lineIndex + 1 });
			}
			continue;
		}

		const directive = parseDirective(containerLine.content);
		if (!directive) {
			if (shouldInclude(conditionalStack)) {
				renderedLines.push(line);
				sourceLines.push({ content: lineBody, sourceLineNumber: lineIndex + 1 });
			}
			continue;
		}

		if (directive.type === 'endif') {
			if (!conditionalStack.pop()) {
				throw new Error('RULES.md contains an unmatched endif directive.');
			}
			continue;
		}

		conditionalStack.push({
			include:
				accessibleGroupNames === undefined ||
				directive.groupNames.some((groupName) => accessibleGroupNames.has(groupName.toLowerCase())),
		});
	}

	if (conditionalStack.length > 0) {
		throw new Error('RULES.md contains a conditional block without a matching endif directive.');
	}

	return { content: renderedLines.join(''), lines: sourceLines };
}

export function isRootRulesPath(filePath: string): boolean {
	const segments = filePath
		.replaceAll('\\', '/')
		.split('/')
		.filter((segment) => segment !== '' && segment !== '.');
	return !segments.includes('..') && segments.length === 1 && segments[0] === 'RULES.md';
}

function parseDirective(line: string): { type: 'if'; groupNames: string[] } | { type: 'endif' } | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith('{%')) {
		return undefined;
	}

	const tag = trimmed.match(/^\{%-?\s*(.*?)\s*-?%\}$/);
	if (!tag) {
		throw new Error('RULES.md contains an unsupported or malformed conditional directive.');
	}

	const body = tag[1].trim();
	if (body === 'endif') {
		return { type: 'endif' };
	}
	if (/^endif\b/.test(body)) {
		throw new Error('RULES.md contains a malformed endif directive.');
	}
	if (!/^if\b/.test(body)) {
		throw new Error('RULES.md contains an unsupported or malformed conditional directive.');
	}

	const match = body.match(/^if\s+group\((.*)\)$/);
	if (!match) {
		throw new Error('RULES.md contains an unsupported or malformed conditional directive.');
	}

	return { type: 'if', groupNames: parseGroupNames(match[1]) };
}

function parseGroupNames(argumentsSource: string): string[] {
	const groupNames: string[] = [];
	let position = 0;

	while (position < argumentsSource.length) {
		position = skipWhitespace(argumentsSource, position);
		if (argumentsSource[position] !== '"') {
			throw new Error('RULES.md group names must be double-quoted strings.');
		}

		const end = findStringEnd(argumentsSource, position);
		let groupName: unknown;
		try {
			groupName = JSON.parse(argumentsSource.slice(position, end + 1));
		} catch {
			throw new Error('RULES.md contains an invalid group name.');
		}
		if (typeof groupName !== 'string' || groupName.length === 0) {
			throw new Error('RULES.md group names cannot be empty.');
		}
		groupNames.push(groupName);
		position = skipWhitespace(argumentsSource, end + 1);

		if (position === argumentsSource.length) {
			break;
		}
		if (argumentsSource[position] !== ',') {
			throw new Error('RULES.md group names must be separated by commas.');
		}
		position = skipWhitespace(argumentsSource, position + 1);
		if (position === argumentsSource.length) {
			throw new Error('RULES.md contains a trailing group name separator.');
		}
	}

	if (groupNames.length === 0) {
		throw new Error('RULES.md group conditions require at least one group name.');
	}
	return [...new Set(groupNames)];
}

function findStringEnd(source: string, start: number): number {
	let escaped = false;
	for (let position = start + 1; position < source.length; position += 1) {
		const character = source[position];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === '\\') {
			escaped = true;
			continue;
		}
		if (character === '"') {
			return position;
		}
	}
	throw new Error('RULES.md contains an unterminated group name.');
}

function skipWhitespace(source: string, start: number): number {
	let position = start;
	while (position < source.length && /\s/.test(source[position])) {
		position += 1;
	}
	return position;
}

function shouldInclude(stack: ConditionalFrame[]): boolean {
	return stack.every((frame) => frame.include);
}

function splitLines(source: string): string[] {
	return source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function removeLineEnding(line: string): string {
	return line.replace(/(?:\r\n|\n|\r)$/, '');
}

type MarkdownContainerLine = {
	content: string;
	containers: MarkdownContainer[];
};

type MarkdownContainer = { type: 'blockquote' } | { type: 'list'; continuationIndent: number };

function parseMarkdownContainerLine(line: string): MarkdownContainerLine {
	let content = expandMarkdownTabs(line);
	const containers: MarkdownContainer[] = [];

	while (true) {
		const blockquote = content.match(/^ {0,3}> ?/);
		if (blockquote) {
			content = content.slice(blockquote[0].length);
			containers.push({ type: 'blockquote' });
			continue;
		}

		const listItem = content.match(/^ {0,3}(?:[*+-]|\d{1,9}[.)]) {1,4}/);
		if (listItem) {
			content = content.slice(listItem[0].length);
			containers.push({ type: 'list', continuationIndent: listItem[0].length });
			continue;
		}
		break;
	}

	return { content, containers };
}

function parseFenceMarker(line: MarkdownContainerLine): Fence | undefined {
	const match = line.content.match(/^ {0,3}(`{3,}|~{3,})/);
	if (!match) {
		return undefined;
	}
	return {
		character: match[1][0] as Fence['character'],
		length: match[1].length,
		containers: line.containers,
	};
}

function isClosingFence(line: string, fence: Fence): boolean {
	const content = stripMarkdownContainers(line, fence.containers);
	if (content === undefined) {
		return false;
	}
	const marker = fence.character.repeat(fence.length);
	return new RegExp(`^ {0,3}${marker}${fence.character}* *$`).test(content);
}

function stripMarkdownContainers(line: string, containers: MarkdownContainer[]): string | undefined {
	let content = expandMarkdownTabs(line);
	for (const container of containers) {
		if (container.type === 'blockquote') {
			const blockquote = content.match(/^ {0,3}> ?/);
			if (!blockquote) {
				return undefined;
			}
			content = content.slice(blockquote[0].length);
			continue;
		}

		const indentation = ' '.repeat(container.continuationIndent);
		if (!content.startsWith(indentation)) {
			return undefined;
		}
		content = content.slice(indentation.length);
	}
	return content;
}

function expandMarkdownTabs(line: string): string {
	let expanded = '';
	let column = 0;
	for (const character of line) {
		if (character === '\t') {
			const spaces = 4 - (column % 4);
			expanded += ' '.repeat(spaces);
			column += spaces;
			continue;
		}
		expanded += character;
		column += 1;
	}
	return expanded;
}
