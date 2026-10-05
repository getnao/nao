import { bucketPieData, labelize } from '@nao/shared/chart-builder';
import { seriesColorAt } from '@nao/shared/chart-series';
import type { ChartConfig } from '@nao/shared/chart-tooltip';
import type { displayChart } from '@nao/shared/tools';
import type { Row } from './columns';

export interface PiePresentation {
	rows: Row[];
	colorFor: (category: string, index: number) => string;
	legendPayload: { value: string; dataKey: string; color: string; isHidden: boolean }[];
	config: ChartConfig;
}

export function piePresentation(rows: Row[], categoryKey: string, value: displayChart.SeriesConfig): PiePresentation {
	const bucketed = bucketPieData(rows, categoryKey, value.data_key);
	const categories = bucketed.map((row) => String(row[categoryKey]));
	const colors = new Map(categories.map((category, index) => [category, seriesColorAt(index)]));
	const config: ChartConfig = {
		[categoryKey]: { label: labelize(categoryKey) },
		[value.data_key]: { label: value.label ?? labelize(value.data_key), valueFormat: value.value_format },
	};
	for (const category of categories) {
		config[category] = { label: labelize(category), color: colors.get(category) };
	}
	return {
		rows: bucketed,
		colorFor: (category, index) => colors.get(category) ?? seriesColorAt(index),
		legendPayload: categories.map((category) => ({
			value: labelize(category),
			dataKey: category,
			color: colors.get(category) ?? seriesColorAt(0),
			isHidden: false,
		})),
		config,
	};
}

export function pieTooltipLabel(items: readonly { name?: unknown }[] | undefined): string {
	const name = items?.[0]?.name;
	return name == null ? '' : labelize(String(name));
}
