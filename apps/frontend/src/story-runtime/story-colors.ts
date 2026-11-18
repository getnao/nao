import { SERIES_COLORS } from '@nao/shared/chart-series';
import type { StoryBlockChartConfig, StoryBlockColors } from '@nao/shared/story-app';

export function resolveBlockColors(config: StoryBlockChartConfig): StoryBlockColors {
	return withColorProbe((compute) => {
		const resolved: Record<string, string> = {};
		for (const { color } of config.series) {
			const computed = color ? compute(color) : null;
			if (color && computed) {
				resolved[color] = computed;
			}
		}
		return { palette: SERIES_COLORS.map((color) => compute(color) ?? ''), resolved };
	});
}

export function resolveSeriesPalette(): string[] {
	return withColorProbe((compute) => SERIES_COLORS.map((color) => compute(color) ?? ''));
}

function withColorProbe<T>(run: (compute: (color: string) => string | null) => T): T {
	const probe = document.createElement('span');
	probe.hidden = true;
	document.body.append(probe);
	try {
		return run((color) => computeColor(probe, color));
	} finally {
		probe.remove();
	}
}

function computeColor(probe: HTMLElement, color: string): string | null {
	probe.style.color = '';
	probe.style.color = color;
	return probe.style.color ? getComputedStyle(probe).color : null;
}
