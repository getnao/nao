import { parseChartAttributes, TAG_ATTRS } from './story-segments';

export interface StoryTab {
	title: string;
	innerCode: string;
}

interface StoryTabsRegion {
	start: number;
	end: number;
	hasClosingTag: boolean;
	blocks: StoryTabBlock[];
}

interface StoryTabBlock extends StoryTab {
	start: number;
	end: number;
	openingEnd: number;
}

export function parseStoryTabs(code: string): StoryTab[] | null {
	const region = findStoryTabsRegion(code);
	if (!region) {
		return null;
	}
	return region.blocks.map(({ title, innerCode }) => ({ title, innerCode }));
}

export function renameStoryTab(code: string, index: number, title: string): string {
	const block = findStoryTabsRegion(code)?.blocks[index];
	if (!block) {
		return code;
	}
	const openingTag = `<tab title="${escapeAttribute(title)}">`;
	return code.slice(0, block.start) + openingTag + code.slice(block.openingEnd);
}

export function replaceStoryTabInner(code: string, index: number, innerCode: string): string {
	const block = findStoryTabsRegion(code)?.blocks[index];
	if (!block) {
		return code;
	}
	const innerEnd = block.openingEnd + block.innerCode.length;
	const trimmedInner = innerCode.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
	const normalizedInner = `\n${trimmedInner}\n`;
	return code.slice(0, block.openingEnd) + normalizedInner + code.slice(innerEnd);
}

export function deleteStoryTab(code: string, index: number): string {
	const region = findStoryTabsRegion(code);
	const block = region?.blocks[index];
	if (!region || !block) {
		return code;
	}

	let start = block.start;
	let end = block.end;
	const followingSeparator = code.slice(end, region.end).match(/^[ \t]*\r?\n[ \t]*\r?\n/);
	if (followingSeparator) {
		end += followingSeparator[0].length;
	} else {
		const precedingSeparator = code.slice(region.start, start).match(/[ \t]*\r?\n[ \t]*\r?\n$/);
		if (precedingSeparator) {
			start -= precedingSeparator[0].length;
		}
	}

	return code.slice(0, start) + code.slice(end);
}

export function moveStoryTab(code: string, fromIndex: number, toIndex: number): string {
	const region = findStoryTabsRegion(code);
	if (!region || fromIndex < 0 || fromIndex >= region.blocks.length || region.blocks.length < 2) {
		return code;
	}
	const clampedToIndex = Math.max(0, Math.min(toIndex, region.blocks.length - 1));
	if (fromIndex === clampedToIndex) {
		return code;
	}

	const blocks = region.blocks.map((block) => code.slice(block.start, block.end));
	const [movedBlock] = blocks.splice(fromIndex, 1);
	blocks.splice(clampedToIndex, 0, movedBlock);

	const firstBlock = region.blocks[0];
	const lastBlock = region.blocks[region.blocks.length - 1];
	return code.slice(0, firstBlock.start) + blocks.join('\n\n') + code.slice(lastBlock.end);
}

export function addStoryTab(code: string, title = 'New tab'): string {
	const lastBlock = findStoryTabsRegion(code)?.blocks.at(-1);
	if (!lastBlock) {
		return code;
	}
	const newBlock = `<tab title="${escapeAttribute(title)}">\n\n</tab>`;
	return code.slice(0, lastBlock.end) + `\n\n${newBlock}` + code.slice(lastBlock.end);
}

function findStoryTabsRegion(code: string): StoryTabsRegion | null {
	const openerMatch = /<tabs\b[^>]*>/.exec(code);
	if (!openerMatch) {
		return null;
	}

	const start = openerMatch.index + openerMatch[0].length;
	const closingIndex = code.indexOf('</tabs>', start);
	const hasClosingTag = closingIndex !== -1;
	const end = hasClosingTag ? closingIndex : code.length;
	const regionCode = code.slice(start, end);
	const tabRegex = new RegExp(`<tab\\b(${TAG_ATTRS})?>([\\s\\S]*?)<\\/tab>`, 'g');
	const blocks: StoryTabBlock[] = [];
	let match: RegExpExecArray | null;

	while ((match = tabRegex.exec(regionCode)) !== null) {
		const blockStart = start + match.index;
		const innerCode = match[2];
		blocks.push({
			title: parseChartAttributes(match[1] ?? '').title ?? '',
			innerCode,
			start: blockStart,
			end: blockStart + match[0].length,
			openingEnd: blockStart + match[0].length - innerCode.length - '</tab>'.length,
		});
	}

	return { start, end, hasClosingTag, blocks };
}

function escapeAttribute(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
