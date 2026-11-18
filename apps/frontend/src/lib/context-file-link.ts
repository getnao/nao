import type { StoryCodeLines } from '@nao/shared/types';

import { parseContextExplorerPath } from '@/lib/context-explorer-search';

export interface ContextFileLink {
	/** The path in the Context Hub, from the project root, like `/docs/glossary.md`. */
	path: string;
	lines: StoryCodeLines | null;
}

const LINES_PATTERN = /^(\d{1,7})(?:\s*[-–]\s*(\d{1,7}))?$/;

/** A context file the agent points at, with the project path the file tools take and its optional `4-8` lines. */
export function parseContextFileLink(path: string, lines: string): ContextFileLink | null {
	const explorerPath = parseContextExplorerPath(`/${path.trim().replace(/^\/+/, '')}`);
	return explorerPath ? { path: explorerPath, lines: parseLines(lines) } : null;
}

/** `L12`, or `L4–8` for several lines. */
export function formatCodeLines({ start, end }: StoryCodeLines): string {
	return start === end ? `L${start}` : `L${start}–${end}`;
}

function parseLines(value: string): StoryCodeLines | null {
	const match = LINES_PATTERN.exec(value.trim());
	if (!match) {
		return null;
	}
	const first = Number(match[1]);
	const last = match[2] ? Number(match[2]) : first;
	const start = Math.min(first, last);
	return start >= 1 ? { start, end: Math.max(first, last) } : null;
}
