import type { ReactNode } from 'react';

const MENTION_LABELS: Record<string, string> = {
	__story__: 'Story mode',
};

/** Serialized prompt mentions look like `trigger[id]` (e.g. `#[__story__]`, `@[schema.table]`, `/[skill]`). */
const MENTION_PATTERN = /[@#/]\[([^\]\s][^\]]*)\]/g;
const INLINE_CODE_PATTERN = /`([^`]+)`/g;

function mentionLabel(id: string): string {
	const known = MENTION_LABELS[id];
	if (known) {
		return known;
	}
	const segments = id.split(/[./]/).filter(Boolean);
	return segments[segments.length - 1] ?? id;
}

function stripMentions(text: string): string {
	return text.replace(MENTION_PATTERN, (_match, id: string) => mentionLabel(id));
}

/** Renders recommendation prose as clean text: mentions become readable labels and backtick spans become inline code. */
export function RecommendationText({ text }: { text: string }): ReactNode {
	const cleaned = stripMentions(text);
	const nodes: ReactNode[] = [];
	let lastIndex = 0;
	let key = 0;

	for (const match of cleaned.matchAll(INLINE_CODE_PATTERN)) {
		const index = match.index ?? 0;
		if (index > lastIndex) {
			nodes.push(cleaned.slice(lastIndex, index));
		}
		nodes.push(
			<code key={key++} className='rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]'>
				{match[1]}
			</code>,
		);
		lastIndex = index + match[0].length;
	}

	if (lastIndex < cleaned.length) {
		nodes.push(cleaned.slice(lastIndex));
	}

	return nodes.length > 0 ? nodes : cleaned;
}
