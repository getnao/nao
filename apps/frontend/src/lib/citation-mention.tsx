import { ChartColumn, ChartLine, ChartPie, Code, Gauge, LayoutPanelTop, MapPin, Quote, Table } from 'lucide-react';
import { CITATION_MENTION_TRIGGER } from '@nao/shared';
import { CODE_CITATION_KIND, MAX_CITATION_TEXT_LENGTH } from '@nao/shared/types';
import type { LucideIcon } from 'lucide-react';
import type { MentionOption, PromptHandle, SelectedMention } from 'prompt-mentions';
import type { CitationData, StoryBlockReference } from '@nao/shared/types';

export { CITATION_MENTION_TRIGGER };

export const CITATION_PILL_SELECTOR = `[data-mention-trigger="${CITATION_MENTION_TRIGGER}"]`;
type CitationFinder = (id: string) => CitationData | undefined;

const CITATION_TOKEN = new RegExp(`${CITATION_MENTION_TRIGGER}\\[([^\\]\\s]+)\\]`, 'g');
const CITATION_TOKEN_WITH_BLANKS = new RegExp(`( ?)${CITATION_TOKEN.source}( ?)`, 'g');
const MAX_PILL_QUOTE_LENGTH = 32;

const BLOCK_ICONS: Record<string, LucideIcon> = {
	kpi: Gauge,
	'data-table': Table,
	'point-map': MapPin,
	[CODE_CITATION_KIND]: Code,
};

export function toCitationMentionOption(citation: CitationData, id: string): MentionOption {
	const Icon = citationIcon(citation);
	return { id, label: describeCitationPill(citation), icon: <Icon className='size-3.5' strokeWidth={2.25} /> };
}

export function describeCitationSource({ start, end, block }: CitationData): string {
	if (!block) {
		return end > start ? `@chars ${start}–${end}` : '@text';
	}
	if (block.kind === 'text') {
		return '@text';
	}
	if (block.kind === CODE_CITATION_KIND) {
		return `@code · ${describeCodeSource(block)}`;
	}
	return block.title ? `@${block.kind} block · ${block.title}` : `@${block.kind} block`;
}

export function isCodeCitation({ block }: CitationData): boolean {
	return block?.kind === CODE_CITATION_KIND;
}

export function toSentCitationOptions(citations: CitationData[], text: string): MentionOption[] {
	return extractCitationIds(text).map((id) => {
		const citation = citations[Number(id) - 1];
		return citation ? toCitationMentionOption(citation, id) : toMissingCitationOption(id);
	});
}

/** Skills, tables and stories the agent loads as context: citations travel with the message instead. */
export function toContextMentions(mentions: SelectedMention[]): MentionOption[] {
	return mentions
		.filter((mention) => mention.trigger !== CITATION_MENTION_TRIGGER)
		.map(({ id, label, trigger }) => ({ id, label, trigger }));
}

export function extractCitationIds(text: string): string[] {
	return [...new Set([...text.matchAll(CITATION_TOKEN)].map((match) => match[1]))];
}

export function numberCitationTokens(text: string, orderedIds: string[]): string {
	return replaceCitationTokens(text, (id) => {
		const position = orderedIds.indexOf(id);
		return position < 0 ? null : `${CITATION_MENTION_TRIGGER}[${position + 1}]`;
	});
}

export function placeCitationsInline(text: string, citationCount: number): string {
	if (citationCount === 0 || extractCitationIds(text).length > 0) {
		return text;
	}
	const pills = Array.from({ length: citationCount }, (_, index) => `${CITATION_MENTION_TRIGGER}[${index + 1}]`);
	return [...pills, text].join(' ').trim();
}

/**
 * Takes the citation pills out of a prompt, the way deleting them would, and lets the prompt read its new value.
 * Each pill leaves with the space the prompt put after it, so pills put back later do not pile up blanks.
 */
export function removeCitationPills(container: HTMLElement): void {
	const input = container.querySelector<HTMLElement>('.prompt-input');
	const pills = input?.querySelectorAll(CITATION_PILL_SELECTOR) ?? [];
	if (!input || pills.length === 0) {
		return;
	}
	pills.forEach((pill) => {
		removeLeadingBlank(pill.nextSibling);
		pill.remove();
	});
	if (!input.textContent?.trim() && !input.querySelector('[data-mention]')) {
		input.replaceChildren();
	}
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function toCopiedText(fragment: DocumentFragment, findCitation: CitationFinder): string {
	return readCopiedNodes(fragment.childNodes, findCitation).replace(/\u200b/g, '');
}

export function writeCitedText(prompt: PromptHandle, text: string, citations: (CitationData & { id: string })[]): void {
	let writtenUpTo = 0;
	let isAfterPill = false;
	for (const match of text.matchAll(CITATION_TOKEN)) {
		const citation = citations[Number(match[1]) - 1];
		insertNonEmptyText(prompt, text.slice(writtenUpTo, match.index), isAfterPill);
		if (citation) {
			prompt.appendMention(toCitationMentionOption(citation, citation.id), CITATION_MENTION_TRIGGER);
		}
		isAfterPill = citation !== undefined;
		writtenUpTo = match.index + match[0].length;
	}
	insertNonEmptyText(prompt, text.slice(writtenUpTo), isAfterPill);
}

export function removeCitationTokens(text: string): string {
	return replaceCitationTokens(text, () => null);
}

export function capCitationText<T extends CitationData>(citation: T): T {
	if (citation.text.length <= MAX_CITATION_TEXT_LENGTH) {
		return citation;
	}
	return { ...citation, text: `${citation.text.slice(0, MAX_CITATION_TEXT_LENGTH - 1)}…` };
}

export function isSameCitation(left: CitationData, right: CitationData): boolean {
	return (
		left.storySlug === right.storySlug &&
		left.storyChatId === right.storyChatId &&
		left.text === right.text &&
		left.start === right.start &&
		left.end === right.end &&
		left.intent === right.intent &&
		left.block?.kind === right.block?.kind &&
		left.block?.title === right.block?.title &&
		left.block?.queryId === right.block?.queryId &&
		left.block?.lines?.start === right.block?.lines?.start &&
		left.block?.lines?.end === right.block?.lines?.end
	);
}

/** A pill reads on one line: the quoted text keeps its words, not its line breaks. */
function describeCitationPill({ block, text }: CitationData): string {
	if (block?.kind === CODE_CITATION_KIND) {
		return describeCodeSource({ ...block, title: block.title?.split('/').pop() });
	}
	if (block && block.kind !== 'text') {
		return toSingleLine(block.title ?? '') || block.kind.replaceAll('-', ' ');
	}
	const quote = toSingleLine(text);
	return quote.length > MAX_PILL_QUOTE_LENGTH ? `${quote.slice(0, MAX_PILL_QUOTE_LENGTH).trimEnd()}…` : quote;
}

function toSingleLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** `index.tsx · L12–20`; code of a markdown story comes from its source, which has no file name. */
function describeCodeSource({ title, lines }: StoryBlockReference): string {
	const source = title || 'Source';
	if (!lines) {
		return source;
	}
	const range = lines.start === lines.end ? `L${lines.start}` : `L${lines.start}–${lines.end}`;
	return `${source} · ${range}`;
}

function citationIcon({ block }: CitationData): LucideIcon {
	const kind = block?.kind ?? 'text';
	if (kind === 'text') {
		return Quote;
	}
	if (kind === 'line-chart' || kind === 'area-chart') {
		return ChartLine;
	}
	if (kind === 'pie-chart') {
		return ChartPie;
	}
	if (kind.endsWith('-chart')) {
		return ChartColumn;
	}
	return BLOCK_ICONS[kind] ?? LayoutPanelTop;
}

function toMissingCitationOption(id: string): MentionOption {
	return { id, label: 'Citation', icon: <Quote className='size-3.5' strokeWidth={2.25} /> };
}

function replaceCitationTokens(text: string, replace: (id: string) => string | null): string {
	return text.replace(CITATION_TOKEN_WITH_BLANKS, (_token, before: string, id: string, after: string) => {
		const replacement = replace(id);
		if (replacement !== null) {
			return `${before}${replacement}${after}`;
		}
		return before && after ? ' ' : '';
	});
}

function insertNonEmptyText(prompt: PromptHandle, text: string, isAfterPill: boolean): void {
	const written = isAfterPill ? text.replace(/^ /, '') : text;
	if (written) {
		prompt.insertText(written);
	}
}

function removeLeadingBlank(node: ChildNode | null): void {
	if (node?.nodeType === Node.TEXT_NODE && node.textContent) {
		node.textContent = node.textContent.replace(/^[\s\u00a0\u200b]/, '');
	}
}

function describeCopiedMention(mention: HTMLElement, findCitation: CitationFinder): string {
	const { mentionTrigger, mentionId = '', mention: label = '' } = mention.dataset;
	if (mentionTrigger !== CITATION_MENTION_TRIGGER) {
		return `${mentionTrigger}[${mentionId}]`;
	}
	const citation = findCitation(mentionId);
	return citation ? `“${toSingleLine(citation.text)}”` : label;
}

function readCopiedNodes(nodes: NodeListOf<ChildNode>, findCitation: CitationFinder): string {
	return [...nodes]
		.map((node) => {
			if (node instanceof HTMLElement && node.dataset.mentionTrigger) {
				return describeCopiedMention(node, findCitation);
			}
			if (node.nodeName === 'BR') {
				return '\n';
			}
			if (node.nodeType === Node.TEXT_NODE) {
				return node.textContent ?? '';
			}
			return readCopiedNodes(node.childNodes, findCitation);
		})
		.join('');
}
