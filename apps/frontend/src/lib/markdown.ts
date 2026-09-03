import { math } from '@streamdown/math';
import type { PluginConfig } from 'streamdown';

export interface ParsedMarkdown {
	frontmatter: string | null;
	label: string | null;
	body: string;
}

export function parseMarkdownFrontmatter(content: string): ParsedMarkdown {
	const contentStart = content.charCodeAt(0) === 0xfeff ? 1 : 0;
	const firstLineEnd = content.indexOf('\n', contentStart);

	if (firstLineEnd === -1 || getLineContent(content, contentStart, firstLineEnd) !== '---') {
		return { frontmatter: null, label: null, body: content };
	}

	const frontmatterStart = firstLineEnd + 1;
	let lineStart = firstLineEnd + 1;
	while (lineStart <= content.length) {
		const lineBreak = content.indexOf('\n', lineStart);
		const lineEnd = lineBreak === -1 ? content.length : lineBreak;
		const line = getLineContent(content, lineStart, lineEnd);

		if (line === '---' || line === '...') {
			const frontmatterContent = content.slice(
				frontmatterStart,
				getFrontmatterEnd(content, frontmatterStart, lineStart),
			);
			const bodyStart = lineBreak === -1 ? lineEnd : lineBreak + 1;
			return {
				frontmatter: content.slice(0, bodyStart),
				label: getFrontmatterLabel(frontmatterContent),
				body: content.slice(bodyStart),
			};
		}
		if (lineBreak === -1) {
			return { frontmatter: null, label: null, body: content };
		}

		lineStart = lineBreak + 1;
	}

	return { frontmatter: null, label: null, body: content };
}

export function joinMarkdownFrontmatter(frontmatter: string | null, body: string): string {
	if (!frontmatter) {
		return body;
	}
	if (!body || frontmatter.endsWith('\n')) {
		return frontmatter + body;
	}
	return `${frontmatter}\n${body}`;
}

/** Streamdown plugins shared across all markdown surfaces (KaTeX math rendering). */
export const markdownPlugins: PluginConfig = { math };

function getLineContent(content: string, start: number, end: number): string {
	const lineEnd = end > start && content[end - 1] === '\r' ? end - 1 : end;
	return content.slice(start, lineEnd);
}

function getFrontmatterEnd(content: string, start: number, closingDelimiterStart: number): number {
	let end = closingDelimiterStart;
	if (end > start && content[end - 1] === '\n') {
		end -= 1;
	}
	if (end > start && content[end - 1] === '\r') {
		end -= 1;
	}
	return end;
}

function getFrontmatterLabel(frontmatter: string): string | null {
	let lineStart = 0;
	while (lineStart <= frontmatter.length) {
		const lineBreak = frontmatter.indexOf('\n', lineStart);
		const lineEnd = lineBreak === -1 ? frontmatter.length : lineBreak;
		const line = getLineContent(frontmatter, lineStart, lineEnd);

		if (line.startsWith('type:')) {
			const type = stripSurroundingQuotes(line.slice('type:'.length).trim());
			return type ? type.charAt(0).toUpperCase() + type.slice(1) : null;
		}
		if (lineBreak === -1) {
			break;
		}

		lineStart = lineBreak + 1;
	}

	return null;
}

function stripSurroundingQuotes(value: string): string {
	const firstCharacter = value.charAt(0);
	if (
		value.length >= 2 &&
		(firstCharacter === '"' || firstCharacter === "'") &&
		value.charAt(value.length - 1) === firstCharacter
	) {
		return value.slice(1, -1).trim();
	}
	return value;
}
