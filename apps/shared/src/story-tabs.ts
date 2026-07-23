import { parseChartAttributes, TAG_ATTRS } from './story-segments';

export interface StoryTab {
	title: string;
	innerCode: string;
}

interface StoryTabBlock extends StoryTab {
	start: number;
	end: number;
	openingEnd: number;
}

export function parseStoryTabs(code: string): StoryTab[] | null {
	if (!/<tab\b[^>]*>/.test(code)) {
		return null;
	}
	return findStoryTabBlocks(code).map(({ title, innerCode }) => ({ title, innerCode }));
}

export function appendBlockToStoryCode(
	code: string,
	block: string,
	options: { usingVisibleStory: boolean; activeTabIndex: number },
): { code: string; tabIndex: number } {
	const tabs = parseStoryTabs(code);
	if (!tabs || tabs.length === 0) {
		return { code: code.trimEnd() + '\n\n' + block, tabIndex: 0 };
	}
	const tabIndex = options.usingVisibleStory
		? Math.min(Math.max(options.activeTabIndex, 0), tabs.length - 1)
		: tabs.length - 1;
	const existingInner = tabs[tabIndex].innerCode.trimEnd();
	const newInner = existingInner ? existingInner + '\n\n' + block : block;
	return { code: replaceStoryTabInner(code, tabIndex, newInner), tabIndex };
}

export function flattenStoryTabs(code: string): string {
	const tabs = parseStoryTabs(code);
	if (!tabs?.length) {
		return code;
	}
	return tabs.map((tab) => `## ${tab.title}\n\n${tab.innerCode.trim()}`).join('\n\n');
}

export function stripStoryTabsMarkup(code: string): string {
	return code
		.replace(/<tabs\b[^>]*>/g, '')
		.replace(/<\/tabs>/g, '')
		.replace(/<tab\b[^>]*>/g, '')
		.replace(/<\/tab>/g, '');
}

export function renameStoryTab(code: string, index: number, title: string): string {
	const block = findStoryTabBlocks(code)[index];
	if (!block) {
		return code;
	}
	const openingTag = `<tab title="${escapeAttribute(title)}">`;
	return code.slice(0, block.start) + openingTag + code.slice(block.openingEnd);
}

export function replaceStoryTabInner(code: string, index: number, innerCode: string): string {
	const block = findStoryTabBlocks(code)[index];
	if (!block) {
		return code;
	}
	const innerEnd = block.openingEnd + block.innerCode.length;
	const trimmedInner = innerCode.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/(?:\r?\n[ \t]*)+$/, '');
	const normalizedInner = `\n${trimmedInner}\n`;
	return code.slice(0, block.openingEnd) + normalizedInner + code.slice(innerEnd);
}

export function deleteStoryTab(code: string, index: number): string {
	const blocks = findStoryTabBlocks(code);
	const block = blocks[index];
	if (!block) {
		return code;
	}

	let start = block.start;
	let end = block.end;
	const firstBlock = blocks[0];
	const lastBlock = blocks[blocks.length - 1];
	const followingSeparator = code.slice(end, lastBlock.end).match(/^[ \t]*\r?\n[ \t]*\r?\n/);
	if (followingSeparator) {
		end += followingSeparator[0].length;
	} else {
		const precedingSeparator = code.slice(firstBlock.start, start).match(/[ \t]*\r?\n[ \t]*\r?\n$/);
		if (precedingSeparator) {
			start -= precedingSeparator[0].length;
		}
	}

	return code.slice(0, start) + code.slice(end);
}

export function moveStoryTab(code: string, fromIndex: number, toIndex: number): string {
	const tabBlocks = findStoryTabBlocks(code);
	if (fromIndex < 0 || fromIndex >= tabBlocks.length || tabBlocks.length < 2) {
		return code;
	}
	const clampedToIndex = Math.max(0, Math.min(toIndex, tabBlocks.length - 1));
	if (fromIndex === clampedToIndex) {
		return code;
	}

	const blocks = tabBlocks.map((block) => code.slice(block.start, block.end));
	const [movedBlock] = blocks.splice(fromIndex, 1);
	blocks.splice(clampedToIndex, 0, movedBlock);

	const firstBlock = tabBlocks[0];
	const lastBlock = tabBlocks[tabBlocks.length - 1];
	return code.slice(0, firstBlock.start) + blocks.join('\n\n') + code.slice(lastBlock.end);
}

export function addStoryTab(code: string, title = 'New tab'): string {
	const lastBlock = findStoryTabBlocks(code).at(-1);
	if (!lastBlock) {
		return code;
	}
	const newBlock = `<tab title="${escapeAttribute(title)}">\n\n</tab>`;
	return code.slice(0, lastBlock.end) + `\n\n${newBlock}` + code.slice(lastBlock.end);
}

function findStoryTabBlocks(code: string): StoryTabBlock[] {
	const tabRegex = new RegExp(`<tab\\b(${TAG_ATTRS})?>([\\s\\S]*?)<\\/tab>`, 'g');
	const blocks: StoryTabBlock[] = [];
	let match: RegExpExecArray | null;

	while ((match = tabRegex.exec(code)) !== null) {
		const blockStart = match.index;
		const innerCode = match[2];
		blocks.push({
			title: parseChartAttributes(match[1] ?? '').title ?? '',
			innerCode,
			start: blockStart,
			end: blockStart + match[0].length,
			openingEnd: blockStart + match[0].length - innerCode.length - '</tab>'.length,
		});
	}

	return blocks;
}

function escapeAttribute(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
