import { useCallback, useMemo, useState } from 'react';

import { DEFAULT_COLORS } from './chart-builder';
import type { ChartConfig } from './chart-tooltip';
import type * as displayChart from './tools/display-chart';

export const SERIES_COLORS = DEFAULT_COLORS.map((_, index) => `var(--chart-${index + 1})`);

export function seriesColorAt(index: number): string {
	return SERIES_COLORS[index % SERIES_COLORS.length];
}

export function useSeriesVisibility(series: displayChart.SeriesConfig[]) {
	const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<Set<string>>(new Set());

	const visibleSeries = useMemo(
		() => series.filter((s) => !hiddenSeriesKeys.has(s.data_key)),
		[series, hiddenSeriesKeys],
	);

	const handleToggleSeriesVisibility = useCallback((dataKey: string) => {
		setHiddenSeriesKeys((prev) => {
			const copy = new Set(prev);
			if (copy.has(dataKey)) {
				copy.delete(dataKey);
			} else {
				copy.add(dataKey);
			}
			return copy;
		});
	}, []);

	return {
		visibleSeries,
		hiddenSeriesKeys,
		handleToggleSeriesVisibility,
	};
}

export function buildSeriesChartConfig(
	series: displayChart.SeriesConfig[],
	labelFor: (dataKey: string) => string,
): ChartConfig {
	return series.reduce<ChartConfig>((acc, s, index) => {
		acc[s.data_key] = {
			label: s.label || labelFor(s.data_key),
			color: s.color || seriesColorAt(index),
			isTotal: s.is_total,
			valueFormat: s.value_format,
		};
		return acc;
	}, {});
}

export function buildSeriesLegendPayload(
	series: displayChart.SeriesConfig[],
	hiddenSeriesKeys: Set<string>,
	labelFor: (dataKey: string) => string,
) {
	return series.map((s, index) => ({
		value: s.label || labelFor(s.data_key),
		dataKey: s.data_key,
		color: s.color || seriesColorAt(index),
		isHidden: hiddenSeriesKeys.has(s.data_key),
	}));
}
