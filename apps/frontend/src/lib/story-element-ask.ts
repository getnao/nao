import { isStoryBlockPartKind } from '@nao/shared/story-parts';
import { CODE_CITATION_KIND } from '@nao/shared/types';
import { capCitationText } from './citation-mention';
import type { StoryElementAsk } from '@nao/shared/story-app';
import type { StoryBlockPart } from '@nao/shared/story-parts';
import type { StoryBlockReference } from '@nao/shared/types';

const MAX_PART_FIELD_LENGTH = 200;

/** Validates an ask posted by the sandboxed story frame, which is untrusted input. */
export function readStoryElementAsk({ block, text }: StoryElementAsk): StoryElementAsk | null {
	const isInspectorBlock =
		typeof block?.kind === 'string' &&
		block.kind !== CODE_CITATION_KIND &&
		isOptionalString(block.title) &&
		isOptionalString(block.queryId);
	if (!isInspectorBlock || typeof text !== 'string') {
		return null;
	}
	const { text: cappedText } = capCitationText({ start: 0, end: 0, text });
	const part = readPart(block.part);
	return {
		block: { kind: block.kind, title: block.title, queryId: block.queryId, ...(part && { part }) },
		text: cappedText,
	};
}

/** A block's own edit button asks about the whole block, so a part posted with it is dropped. */
export function toWholeBlockReference(block: StoryBlockReference): StoryBlockReference {
	const { part: _part, ...reference } = block;
	return reference;
}

function readPart(part: unknown): StoryBlockPart | undefined {
	if (typeof part !== 'object' || part === null) {
		return undefined;
	}
	const { kind, label, series, category, value } = part as Record<string, unknown>;
	const fields = [label, series, category, value];
	if (!isStoryBlockPartKind(kind) || !fields.every(isOptionalShortString)) {
		return undefined;
	}
	return { kind, label, series, category, value } as StoryBlockPart;
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === 'string';
}

function isOptionalShortString(value: unknown): boolean {
	return value === undefined || (typeof value === 'string' && value.length <= MAX_PART_FIELD_LENGTH);
}
