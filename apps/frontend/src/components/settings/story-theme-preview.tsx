import type { StoryTheme } from '@nao/shared/story-theme';

import { StoryThemeProvider } from '@/components/story-theme-provider';

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

const BARS = [72, 46, 88, 61, 39, 80, 54];
const LINE = [38, 52, 44, 68, 59, 81, 74];
const TICKS = ['May 25', 'Jun 8', 'Jun 22', 'Jul 6', 'Jul 20', 'Aug 3', 'Aug 17'];

export function StoryThemePreview({ theme }: { theme: StoryTheme }) {
	return (
		<StoryThemeProvider override={theme}>
			<div className='overflow-hidden rounded-lg border bg-background text-foreground'>
				{/* Tab strip, as story-tabbed-content renders it */}
				<div className='flex items-center gap-1 border-b px-4'>
					{['Overview', 'By country'].map((tab, i) => (
						<span
							key={tab}
							className={
								i === 0
									? 'border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground'
									: 'border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground'
							}
						>
							{tab}
						</span>
					))}
				</div>

				<div className='flex flex-col gap-4 p-4'>
					<div>
						<h3 className='text-lg leading-tight font-semibold'>Weekly active users</h3>
						<p className='mt-1 text-sm text-muted-foreground'>
							How a story looks with this design system: the same filter bar, cards, charts and labels
							your stories already use.
						</p>
					</div>

					{/* Filter bar, matching story-filter-bar.tsx */}
					<div className='flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3'>
						{[
							['Country', 'All countries'],
							['Instance', 'Deployed'],
						].map(([label, value]) => (
							<div key={label} className='flex min-w-36 flex-col gap-1'>
								<span className='text-xs font-medium text-muted-foreground'>{label}</span>
								<div className='flex h-8 min-w-36 items-center justify-between rounded-md border bg-background px-3 text-xs'>
									<span>{value}</span>
									<span className='text-muted-foreground'>&#9662;</span>
								</div>
							</div>
						))}
						<span className='flex h-8 items-center px-2 text-xs text-muted-foreground'>Clear</span>
					</div>

					<div className='grid grid-cols-3 gap-3'>
						{[
							['Latest week', '3,044'],
							['Average', '3,275'],
							['Peak', '5,946'],
						].map(([label, value]) => (
							<div key={label} className='rounded-lg border bg-card p-3'>
								<div className='text-xs font-medium text-muted-foreground'>{label}</div>
								<div className='mt-1 text-xl font-semibold'>{value}</div>
							</div>
						))}
					</div>

					<div className='rounded-lg border bg-card p-3'>
						<div className='mb-3 text-sm font-medium'>Users per week</div>
						<div className='flex h-24 items-end gap-2'>
							{BARS.map((h, i) => (
								<div
									key={i}
									className='flex-1 rounded-t-[3px]'
									style={{ height: `${h}%`, background: `var(--chart-${(i % 7) + 1})` }}
								/>
							))}
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
							{[0, 1].map((series) => (
								<polyline
									key={series}
									fill='none'
									strokeWidth='2'
									stroke={`var(--chart-${series + 1})`}
									points={LINE.map(
										(v, i) =>
											`${(i * 280) / (LINE.length - 1)},${80 - (series ? v * 0.6 : v) * 0.8}`,
									).join(' ')}
								/>
							))}
						</svg>
						{/* Legend, as ChartLegendContent renders it */}
						<div className='mt-2 flex flex-wrap items-center justify-center gap-4 border-t pt-2'>
							{['Deployed', 'Local'].map((label, i) => (
								<span key={label} className='flex items-center gap-1.5 text-xs text-muted-foreground'>
									<span
										className='size-2 shrink-0 rounded-[2px]'
										style={{ background: `var(--chart-${i + 1})` }}
									/>
									{label}
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
