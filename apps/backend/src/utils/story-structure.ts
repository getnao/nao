import { TAG_ATTRS } from '@nao/shared/story-segments';
import { formatColumnLabel } from '@nao/shared/story-table-utils';
import {
	STORY_VIEWER_RESTRICTED_CODE_MARKER,
	VIEWER_NARRATIVE_PLACEHOLDER,
	VIEWER_SECTION_PLACEHOLDER,
} from '@nao/shared/story-viewer-restrictions';

/** The story with its structure kept and every piece of owner-written copy replaced by a placeholder. */
export function buildViewerSafeStorySource(code: string): string {
	const tags: string[] = [];
	const tokenized = code.replace(storyStructureTokenRegex(), (tag) => {
		const index = tags.push(redactViewerStoryTag(tag)) - 1;
		return `@@NAO_STORY_TAG_${index}@@`;
	});
	const redacted = tokenized
		.split('\n')
		.map((line) => {
			const placeholders = line.match(/@@NAO_STORY_TAG_\d+@@/g) ?? [];
			const heading = line.match(/^\s*(#{1,6})\s+/);
			if (heading) {
				return [`${heading[1]} ${VIEWER_SECTION_PLACEHOLDER}`, ...placeholders].join(' ');
			}
			if (placeholders.length > 0) {
				return placeholders.join(' ');
			}
			return line.trim() ? VIEWER_NARRATIVE_PLACEHOLDER : '';
		})
		.join('\n');
	return markViewerRestricted(
		redacted.replace(/@@NAO_STORY_TAG_(\d+)@@/g, (_placeholder, index: string) => tags[Number(index)] ?? ''),
	);
}

/** A rewrite may drop the marker; without it the page would show leftover placeholders and no access notice. */
export function markViewerRestricted(code: string): string {
	return code.includes(STORY_VIEWER_RESTRICTED_CODE_MARKER)
		? code
		: `${STORY_VIEWER_RESTRICTED_CODE_MARKER}\n${code}`;
}

export function stripHardcodedFilterOptions(code: string): string {
	const filterTagRegex = new RegExp(String.raw`<filter\s+${TAG_ATTRS}\/?>`, 'g');
	const optionsAttributeRegex = /\s+options\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
	return code.replace(filterTagRegex, (tag) => tag.replace(optionsAttributeRegex, ''));
}

export function extractStructureTokens(code: string): string[] {
	return code.match(storyStructureTokenRegex()) ?? [];
}

const LIST_ITEM_MARKER = /^(?:[-*+]|\d+[.)])\s+/;

export interface ProseBlock {
	kind: 'paragraph' | 'list-item';
	text: string;
	firstLine: number;
	lastLine: number;
}

/** The paragraphs and list items of a story, without its headings and tags, with the lines they span. */
export function extractProseBlocks(code: string): ProseBlock[] {
	const structureLines = findStructureLines(code);
	const blocks: ProseBlock[] = [];
	let currentBlock: ProseBlock | null = null;
	for (const [lineIndex, line] of code.split('\n').entries()) {
		const text = line.trim();
		if (!text || structureLines.has(lineIndex) || isHeadingLine(text) || isThematicBreak(text)) {
			currentBlock = null;
		} else if (isListItemLine(text)) {
			currentBlock = {
				kind: 'list-item',
				text: text.replace(LIST_ITEM_MARKER, ''),
				firstLine: lineIndex,
				lastLine: lineIndex,
			};
			blocks.push(currentBlock);
		} else if (currentBlock) {
			currentBlock.text += ` ${text}`;
			currentBlock.lastLine = lineIndex;
		} else {
			currentBlock = { kind: 'paragraph', text, firstLine: lineIndex, lastLine: lineIndex };
			blocks.push(currentBlock);
		}
	}
	return blocks;
}

/** The candidate story with some of its blocks put back as the original story wrote them. */
export function restoreProseBlocks(
	candidateCode: string,
	originalCode: string,
	blocks: { original: ProseBlock; candidate: ProseBlock }[],
): string {
	const candidateLines = candidateCode.split('\n');
	const originalLines = originalCode.split('\n');
	const lastBlockFirst = [...blocks].sort((left, right) => right.candidate.firstLine - left.candidate.firstLine);
	for (const { original, candidate } of lastBlockFirst) {
		candidateLines.splice(
			candidate.firstLine,
			candidate.lastLine - candidate.firstLine + 1,
			...originalLines.slice(original.firstLine, original.lastLine + 1),
		);
	}
	return candidateLines.join('\n');
}

export function stripViewerSensitiveTagCopy(tag: string): string {
	const sensitiveAttributeRegex = new RegExp(
		String.raw`\s+(?:title|label|x_axis_label|y_axis_label|y_axis_right_label)\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`,
		'g',
	);
	const withoutDisplayCopy = redactViewerSeriesLabels(tag.replace(sensitiveAttributeRegex, ''));
	return withoutDisplayCopy.startsWith('<filter ')
		? withoutDisplayCopy.replace(
				new RegExp(String.raw`\s+options\s*=\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`, 'g'),
				'',
			)
		: withoutDisplayCopy;
}

function storyStructureTokenRegex(): RegExp {
	return new RegExp(
		String.raw`<grid(?:\s+${TAG_ATTRS})?>|<\/grid>|<chart\s+${TAG_ATTRS}\/?>|<table\s+${TAG_ATTRS}\/?>|<filter\s+${TAG_ATTRS}\/?>|<map\s+${TAG_ATTRS}\/?>|<parameter\s+${TAG_ATTRS}\/?>|<tab\s+${TAG_ATTRS}>|<\/tab>`,
		'g',
	);
}

function findStructureLines(code: string): Set<number> {
	const structureLines = new Set<number>();
	for (const match of code.matchAll(storyStructureTokenRegex())) {
		const firstLine = countLineBreaks(code.slice(0, match.index));
		const lastLine = firstLine + countLineBreaks(match[0]);
		for (let line = firstLine; line <= lastLine; line++) {
			structureLines.add(line);
		}
	}
	return structureLines;
}

function countLineBreaks(text: string): number {
	return text.split('\n').length - 1;
}

function isHeadingLine(line: string): boolean {
	return /^#{1,6}\s+\S/.test(line);
}

function isThematicBreak(line: string): boolean {
	return /^(?:-{3,}|\*{3,}|_{3,})$/.test(line);
}

function isListItemLine(line: string): boolean {
	return LIST_ITEM_MARKER.test(line);
}

function redactViewerStoryTag(tag: string): string {
	const redacted = stripViewerSensitiveTagCopy(tag);
	if (redacted.startsWith('<tab ') && !/\stitle\s*=/.test(redacted)) {
		return redacted.replace(/>$/, ' title="Section">');
	}
	return redacted;
}

function redactViewerSeriesLabels(tag: string): string {
	let foundSeries = false;
	const redacted = tag.replace(/(\s+series\s*=\s*)'([^']*)'/g, (attribute, prefix: string, value: string) => {
		foundSeries = true;
		try {
			const series = JSON.parse(value);
			if (!Array.isArray(series)) {
				return attribute.replace(/("label"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"Series"');
			}
			const safeSeries = series.map((item) => {
				if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.label !== 'string') {
					return item;
				}
				const dataKey = typeof item.data_key === 'string' && /^\w+$/.test(item.data_key) ? item.data_key : '';
				return { ...item, label: dataKey ? formatColumnLabel(dataKey) : 'Series' };
			});
			return `${prefix}'${JSON.stringify(safeSeries)}'`;
		} catch {
			return attribute.replace(/("label"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"Series"');
		}
	});
	return foundSeries ? redacted : redacted.replace(/("label"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"Series"');
}
