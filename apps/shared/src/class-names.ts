export type ClassValue = string | false | null | undefined | Record<string, boolean | undefined>;

/** Surfaces with Tailwind pass `tailwind-merge`; sandboxed stories keep the plain join and stay light. */
export type ClassNameMerger = (...values: ClassValue[]) => string;

export const joinClassNames: ClassNameMerger = (...values) => values.flatMap(toClassNames).join(' ');

function toClassNames(value: ClassValue): string[] {
	if (!value) {
		return [];
	}
	if (typeof value === 'string') {
		return [value];
	}
	return Object.entries(value)
		.filter(([, enabled]) => enabled)
		.map(([className]) => className);
}
