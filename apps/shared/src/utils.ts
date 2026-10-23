import type { z } from 'zod';

export const CONTEXT_CONFIG_FILENAME = 'nao_config.yaml';

export const TOOL_LABELS: Record<string, string> = {
	'tool-read': 'file',
	'tool-search': 'search',
	'tool-grep': 'search',
	'tool-list': 'folder',
	'tool-execute_sql': 'query',
	'tool-execute_semantic_query': 'query',
	'tool-task': 'subagent',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
	let timeout: ReturnType<typeof setTimeout>;
	return (...args: Parameters<T>) => {
		clearTimeout(timeout);
		timeout = setTimeout(() => {
			func(...args);
		}, delay);
	};
}

/** Reads a value stored as JSON text or as an already-parsed object; anything unreadable is null. */
export function parseStoredJson<Schema extends z.ZodType>(raw: unknown, schema: Schema): z.output<Schema> | null {
	const value = typeof raw === 'string' ? safeJsonParse(raw) : raw;
	if (value === null || typeof value !== 'object') {
		return null;
	}
	const result = schema.safeParse(value);
	return result.success ? result.data : null;
}

export function joinWithAnd(items: string[]): string {
	if (items.length < 2) {
		return items[0] ?? '';
	}
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function safeJsonParse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
