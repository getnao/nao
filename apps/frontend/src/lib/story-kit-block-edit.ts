import { DEFAULT_COLORS } from '@nao/shared/chart-builder';
import { formatHex, parse } from 'culori';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import type {
	StoryBlockChartConfig,
	StoryBlockColors,
	StoryKitBlockChange,
	StoryKitBlockRef,
} from '@nao/shared/story-app';
import { kitBlockFromConfig } from '@/story-runtime/story-kit/block-config';

/** Props that pick the chart variant of a component; they are meaningless once the component changes. */
const VARIANT_PROPS = ['type', 'stacked', 'horizontal', 'percent', 'area'];

const FORMAT_SHORTHAND_PROPS = ['format', 'currency', 'decimals'];

/**
 * Turns a dialog edit into the smallest JSX change: only props whose kit value actually differs are
 * touched, so everything the dialog does not model (className, height, derived data…) stays as written.
 */
export function diffKitBlock(
	block: StoryKitBlockRef,
	original: StoryBlockChartConfig,
	next: StoryBlockChartConfig,
): StoryKitBlockChange | null {
	const before = kitBlockFromConfig(original);
	const after = kitBlockFromConfig(next);
	const componentChanged = after.component !== block.component;
	const keys = new Set([...Object.keys(before.props), ...Object.keys(after.props)]);
	if (componentChanged) {
		VARIANT_PROPS.forEach((key) => keys.add(key));
	}

	const change: StoryKitBlockChange = { set: {}, unset: [] };
	for (const key of keys) {
		const nextValue = after.props[key];
		const forced = componentChanged && VARIANT_PROPS.includes(key);
		if (!forced && isSameValue(before.props[key], nextValue)) {
			continue;
		}
		if (nextValue === undefined) {
			change.unset.push(key);
		} else {
			change.set[key] = nextValue;
		}
	}
	if (componentChanged) {
		change.component = after.component;
	}
	if (!isSameValue(valueFormatsOf(before.props), valueFormatsOf(after.props))) {
		change.unset.push(...FORMAT_SHORTHAND_PROPS.filter((key) => !(key in change.set)));
	}

	const isEmpty = !componentChanged && change.unset.length === 0 && Object.keys(change.set).length === 0;
	return isEmpty ? null : change;
}

/** Formats go on the `DataTable` as `conditionalFormats`; clearing every rule removes the prop instead of writing `{}`. */
export function tableFormatChange(
	current: ColumnConditionalFormats,
	next: ColumnConditionalFormats,
): StoryKitBlockChange | null {
	if (isSameValue(current, next)) {
		return null;
	}
	return Object.keys(next).length === 0
		? { set: {}, unset: ['conditionalFormats'] }
		: { set: { conditionalFormats: next }, unset: [] };
}

/** The dialog only understands hex colours, so explicit series colours are shown as the frame rendered them. */
export function toDialogConfig(config: StoryBlockChartConfig, colors: StoryBlockColors): StoryBlockChartConfig {
	return {
		...config,
		series: config.series.map((series) =>
			series.color ? { ...series, color: colors.resolved[series.color] ?? series.color } : series,
		),
	};
}

/** Puts back each colour as the story wrote it (`var(--chart-3)`, `teal`…) unless the user picked another one. */
export function fromDialogConfig(
	original: StoryBlockChartConfig,
	colors: StoryBlockColors,
	next: StoryBlockChartConfig,
): StoryBlockChartConfig {
	const originalColors = new Map(original.series.map((series) => [series.data_key, series.color]));
	return {
		...next,
		series: next.series.map((series) => {
			const written = originalColors.get(series.data_key);
			const unchanged = written !== undefined && colors.resolved[written] === series.color;
			return unchanged ? { ...series, color: written } : series;
		}),
	};
}

/** The dialog's colour pickers need hex; the frame sends colours as its CSS engine computed them. */
export function toHexColors({ palette, resolved }: StoryBlockColors): StoryBlockColors {
	return {
		palette: palette.map((color, index) => toHex(color) ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]),
		resolved: Object.fromEntries(
			Object.entries(resolved).flatMap(([written, color]) => {
				const hex = toHex(color);
				return hex ? [[written, hex]] : [];
			}),
		),
	};
}

function toHex(color: string): string | undefined {
	const parsed = parse(color);
	return parsed ? formatHex(parsed) : undefined;
}

function valueFormatsOf(props: Record<string, unknown>): unknown[] {
	const series = Array.isArray(props.series) ? props.series : [];
	return [
		props.valueFormat,
		...series.map((spec: unknown) =>
			typeof spec === 'object' && spec !== null ? (spec as { valueFormat?: unknown }).valueFormat : undefined,
		),
	];
}

function isSameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
