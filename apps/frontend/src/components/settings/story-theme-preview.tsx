import { useMemo, useState } from 'react';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';
import type { StoryFilterSelection } from '@nao/shared/sql-template';
import type { StoryTheme } from '@nao/shared/story-theme';

import { StoryFilterBar } from '@/components/story-filter-bar';
import { StoryThemeProvider } from '@/components/story-theme-provider';
import { StoryTabsBar } from '@/components/side-panel/story-tabs-bar';

/**
 * A miniature story rendered in a candidate theme.
 *
 * Built from the same token classes the real story components use - `bg-card`,
 * `text-muted-foreground`, `border`, `var(--chart-N)` - and wrapped in the same
 * StoryThemeProvider that wraps a real story. An earlier version painted
 * hand-picked inline hex values, so the preview could look fine while an actual
 * story did not, and its filter chips looked nothing like nao's filter bar.
 * Anything that changes in the real components should change here too.
 */

const TICKS = ['May 25', 'Jun 8', 'Jun 22', 'Jul 6', 'Jul 20', 'Aug 3', 'Aug 17'];

const SERIES = {
	Deployed: [3044, 2180, 4120, 2860, 1840, 3760, 2540],
	Local: [1889, 1320, 2560, 1740, 1120, 2280, 1590],
};

const TABS = [{ title: 'Overview' }, { title: 'By country' }];

/**
 * Real filter blocks, so StoryFilterBar renders exactly what a story renders:
 * its own Select, its own popover, its own Clear button. Hardcoded `options`
 * keep it from reaching for the warehouse.
 */
const FILTERS: ParsedFilterBlock[] = [
	{
		id: 'country',
		label: 'Country',
		filterType: 'select',
		options: ['All countries', 'France', 'United States', 'Spain'],
	},
	{ id: 'instance', label: 'Instance', filterType: 'select', options: ['All', 'Deployed', 'Local'] },
];

export function StoryThemePreview({ theme }: { theme: StoryTheme }) {
	// Interactive on purpose: an admin should be able to see what a hover
	// tooltip, an open control and a selected tab look like before publishing,
	// because those states carry most of a design system's personality.
	const [tabIndex, setTabIndex] = useState(0);
	const [selections, setSelections] = useState<Record<string, StoryFilterSelection>>({});
	const [hovered, setHovered] = useState<number | null>(null);

	const instance = typeof selections.instance === 'string' ? selections.instance : 'All';
	const visible = useMemo(
		() =>
			instance === 'Deployed'
				? (['Deployed'] as const)
				: instance === 'Local'
					? (['Local'] as const)
					: (['Deployed', 'Local'] as const),
		[instance],
	);
	const totals = useMemo(() => TICKS.map((_, i) => visible.reduce((sum, key) => sum + SERIES[key][i], 0)), [visible]);
	const max = Math.max(...totals, 1);
	const fmt = (n: number) => n.toLocaleString('en-US');

	return (
		<StoryThemeProvider override={theme}>
			<div className='overflow-hidden rounded-lg border bg-background text-foreground'>
				{/* The real tabs bar, exactly as story-tabbed-content mounts it */}
				<StoryTabsBar tabs={TABS} activeIndex={tabIndex} onSelect={setTabIndex} contentClassName='px-4' />

				<div className='flex flex-col gap-4 p-4'>
					<div>
						<h3 className='text-lg leading-tight font-semibold'>
							{tabIndex === 0 ? 'Weekly active users' : 'Users by country'}
						</h3>
						<p className='mt-1 text-sm text-muted-foreground'>
							How a story looks with this design system. Change a filter, switch tabs or hover a bar: the
							states are live.
						</p>
					</div>

					{/* The real filter bar, not a lookalike */}
					<StoryFilterBar
						filters={FILTERS}
						selections={selections}
						onSelectionChange={(id, selection) => setSelections((prev) => ({ ...prev, [id]: selection }))}
						onClear={() => setSelections({})}
					/>

					<div className='grid grid-cols-3 gap-3'>
						{[
							['Latest week', fmt(totals[totals.length - 1])],
							['Average', fmt(Math.round(totals.reduce((a, b) => a + b, 0) / totals.length))],
							['Peak', fmt(Math.max(...totals))],
						].map(([label, value]) => (
							<div key={label} className='rounded-lg border bg-card p-3'>
								<div className='text-xs font-medium text-muted-foreground'>{label}</div>
								<div className='mt-1 text-xl font-semibold'>{value}</div>
							</div>
						))}
					</div>

					{/* Stacked bars with a hover tooltip, as a chart block renders */}
					<div className='rounded-lg border bg-card p-3'>
						<div className='mb-3 text-sm font-medium'>Users per week</div>
						<div className='relative flex h-28 items-end gap-2'>
							{TICKS.map((tick, i) => (
								<button
									type='button'
									key={tick}
									onMouseEnter={() => setHovered(i)}
									onMouseLeave={() => setHovered(null)}
									onFocus={() => setHovered(i)}
									onBlur={() => setHovered(null)}
									className='flex h-full flex-1 flex-col justify-end gap-[2px]'
									aria-label={`${tick}: ${fmt(totals[i])} users`}
								>
									{visible.map((key, s2) => (
										<span
											key={key}
											className='block rounded-t-[3px]'
											style={{
												height: `${(SERIES[key][i] / max) * 100}%`,
												background: `var(--chart-${s2 + 1})`,
												opacity: hovered === null || hovered === i ? 1 : 0.45,
											}}
										/>
									))}
								</button>
							))}
							{hovered !== null && (
								<div className='pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm'>
									<div className='font-medium'>{TICKS[hovered]}</div>
									{visible.map((key, s2) => (
										<div key={key} className='mt-0.5 flex items-center gap-2'>
											<span
												className='size-2 shrink-0 rounded-[2px]'
												style={{ background: `var(--chart-${s2 + 1})` }}
											/>
											<span className='text-muted-foreground'>{key}</span>
											<span className='ml-auto font-medium'>{fmt(SERIES[key][hovered])}</span>
										</div>
									))}
								</div>
							)}
						</div>
						<div className='mt-2 flex justify-between border-t pt-2 text-[10px] text-muted-foreground'>
							{TICKS.map((t) => (
								<span key={t}>{t}</span>
							))}
						</div>
					</div>

					<div className='rounded-lg border bg-card p-3'>
						<div className='mb-3 text-sm font-medium'>Trend</div>
						<svg viewBox='0 0 280 80' className='h-24 w-full' role='img' aria-label='Example line chart'>
							{[0, 20, 40, 60, 80].map((y) => (
								<line
									key={y}
									x1='0'
									x2='280'
									y1={y}
									y2={y}
									stroke='var(--chart-grid)'
									strokeWidth='1'
								/>
							))}
							{visible.map((key, s2) => (
								<polyline
									key={key}
									fill='none'
									strokeWidth='2'
									stroke={`var(--chart-${s2 + 1})`}
									points={SERIES[key]
										.map((v, i) => `${(i * 280) / (TICKS.length - 1)},${80 - (v / max) * 76}`)
										.join(' ')}
								/>
							))}
						</svg>
						{/* Legend, as ChartLegendContent renders it */}
						<div className='mt-2 flex flex-wrap items-center justify-center gap-4 border-t pt-2'>
							{visible.map((key, s2) => (
								<span key={key} className='flex items-center gap-1.5 text-xs text-muted-foreground'>
									<span
										className='size-2 shrink-0 rounded-[2px]'
										style={{ background: `var(--chart-${s2 + 1})` }}
									/>
									{key}
								</span>
							))}
						</div>
					</div>

					<div className='flex flex-wrap gap-3'>
						{theme.charts.series.map((c) => (
							<span key={c} className='flex items-center gap-1.5 text-[11px] text-muted-foreground'>
								<span className='size-2.5 rounded-[2px]' style={{ background: c }} />
								{c}
							</span>
						))}
					</div>
				</div>
			</div>
		</StoryThemeProvider>
	);
}
