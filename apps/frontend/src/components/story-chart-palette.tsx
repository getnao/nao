import { useEffect } from 'react';

import { useStoryTheme } from '@/hooks/use-story-theme';

/**
 * Apply the workspace chart palette everywhere charts are drawn.
 *
 * The design system is scoped to stories, which is right for surfaces and type:
 * an admin theming stories for their business users should not find the nao
 * chrome repainted. Series colours are the exception. A chart in chat and the
 * same chart embedded in a story are the same chart, and seeing one in the
 * brand palette and the other in nao's defaults reads as a bug.
 *
 * So this writes only the series slots - the ones chart components read - onto
 * the document root, and leaves every other token to the story scope.
 */
const CHART_VARS = 7;

export function StoryChartPalette() {
	const { theme } = useStoryTheme();

	useEffect(() => {
		const root = document.documentElement;
		const applied: string[] = [];

		if (theme) {
			for (let i = 0; i < CHART_VARS; i++) {
				const name = `--chart-${i + 1}`;
				root.style.setProperty(name, theme.charts.series[i % theme.charts.series.length]);
				applied.push(name);
			}
			root.style.setProperty('--chart-grid', theme.charts.grid);
			applied.push('--chart-grid');
		}

		return () => {
			// Removing the inline value hands the token back to the stylesheet, so
			// turning a theme off restores nao's palette rather than leaving the
			// last brand's colours stuck on the root.
			for (const name of applied) {
				root.style.removeProperty(name);
			}
		};
	}, [theme]);

	return null;
}
