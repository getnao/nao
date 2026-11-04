export const STORY_BLOCK_PART_KINDS = [
	'title',
	'description',
	'x-axis',
	'y-axis',
	'axis-tick',
	'legend-item',
	'data-point',
	'reference-line',
	'kpi-name',
	'kpi-value',
	'kpi-comparison',
	'column',
	'cell',
] as const;

export type StoryBlockPartKind = (typeof STORY_BLOCK_PART_KINDS)[number];

export interface StoryBlockPart {
	kind: StoryBlockPartKind;
	label?: string;
	series?: string;
	category?: string;
	value?: string;
}

export const PART_SELECTOR = '[data-nao-part]';

export function isStoryBlockPartKind(value: unknown): value is StoryBlockPartKind {
	return STORY_BLOCK_PART_KINDS.some((kind) => kind === value);
}

export function partAttributes(part: StoryBlockPart): Record<string, string> {
	const attributes: Record<string, string | undefined> = {
		'data-nao-part': part.kind,
		'data-nao-part-label': part.label,
		'data-nao-part-series': part.series,
		'data-nao-part-category': part.category,
		'data-nao-part-value': part.value,
	};
	return Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined)) as Record<
		string,
		string
	>;
}

export function readPart(dataset: DOMStringMap, fallbackLabel?: string): StoryBlockPart | null {
	const kind = dataset.naoPart;
	if (!isStoryBlockPartKind(kind)) {
		return null;
	}
	const label = dataset.naoPartLabel?.trim() || fallbackLabel?.trim();
	if (!label) {
		return null;
	}
	return withoutEmptyFields({
		kind,
		label,
		series: dataset.naoPartSeries,
		category: dataset.naoPartCategory,
		value: dataset.naoPartValue,
	});
}

function withoutEmptyFields(part: StoryBlockPart): StoryBlockPart {
	return Object.fromEntries(Object.entries(part).filter(([, value]) => value)) as unknown as StoryBlockPart;
}
