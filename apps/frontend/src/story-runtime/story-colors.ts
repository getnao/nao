import { SERIES_COLORS } from '@nao/shared/chart-series';
import type { StoryBlockChartConfig, StoryBlockColors } from '@nao/shared/story-app';

export function resolveBlockColors(config: StoryBlockChartConfig): StoryBlockColors {
	const probe = document.createElement('span');
	probe.hidden = true;
	document.body.append(probe);
	try {
		const compute = (color: string) => computeColor(probe, color);
		const resolved: Record<string, string> = {};
		for (const { color } of config.series) {
			const computed = color ? compute(color) : null;
			if (color && computed) {
				resolved[color] = computed;
			}
		}
		return { palette: SERIES_COLORS.map((color) => compute(color) ?? ''), resolved };
	} finally {
		probe.remove();
	}
}

function computeColor(probe: HTMLElement, color: string): string | null {
	probe.style.color = '';
	probe.style.color = color;
	return probe.style.color ? getComputedStyle(probe).color : null;
}
