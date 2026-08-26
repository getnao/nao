import { useMemo, useState } from 'react';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';
import type { StoryFilterSelection } from '@nao/shared/sql-template';
import type { StoryTheme } from '@nao/shared/story-theme';

import { DataTableCard } from '@/components/data-table-card';
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

/**
 * Six series, so the whole palette is on screen.
 *
 * Two series only ever exercised --chart-1 and --chart-2, which is not enough
 * to judge a palette: the colours that clash are usually further down the list.
 */
const COUNTRIES = ['United States', 'France', 'Spain', 'United Kingdom', 'India', 'Germany'];

/** Real DataTableCard input, so the preview shows nao's own table, not a mock-up. */
const TABLE_COLUMNS = ['Country', 'Users', 'Messages', 'Share'];
const BY_COUNTRY = [
	[820, 910, 1180, 1010, 640, 1240, 890],
	[610, 700, 940, 780, 520, 980, 720],
	[380, 420, 560, 470, 310, 590, 430],
	[240, 280, 350, 300, 200, 380, 275],
	[160, 190, 240, 205, 140, 260, 185],
	[120, 140, 180, 155, 105, 195, 140],
];

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
	const [lineHover, setLineHover] = useState<number | null>(null);

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
	// Separation comes from the surface or a border, never both - the same rule
	// the guard applies to a published theme.
	// The slots that make a brand look like itself: figure face and size, label
	// case, density, bar geometry, and whether the lead chart is inverted.
	const t = theme.typography;
	const figureStyle = {
		fontFamily: t.figureFont === 'heading' ? t.headingFont : t.bodyFont,
		fontSize: `${t.figureScale}rem`,
		letterSpacing: t.figureFont === 'heading' ? `${t.headingTracking}em` : undefined,
		lineHeight: 1.05,
	};
	const labelClass =
		t.labelStyle === 'uppercase-tracked'
			? 'text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground'
			: 'text-xs font-medium text-muted-foreground';
	const pad = { compact: 'p-2.5', regular: 'p-3.5', spacious: 'p-6' }[theme.layout.density];
	const gap = { compact: 'gap-2', regular: 'gap-4', spacious: 'gap-7' }[theme.layout.density];
	const heroInverted = theme.layout.emphasis === 'inverted-hero';
	const heroStyle = heroInverted
		? { background: theme.layout.invertedSurface, color: theme.layout.invertedInk }
		: undefined;

	const cardClass =
		theme.shape.elevation === 'bordered'
			? 'rounded-lg border bg-card'
			: theme.shape.elevation === 'shadowed'
				? 'rounded-lg bg-card shadow-sm'
				: 'rounded-lg bg-card';

	const tableTotal = BY_COUNTRY.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0);
	const countryMax = Math.max(...TICKS.map((_, i) => BY_COUNTRY.reduce((sum, row) => sum + row[i], 0)), 1);
	const fmt = (n: number) => n.toLocaleString('en-US');

	return (
		<StoryThemeProvider override={theme}>
			<div className='overflow-hidden rounded-lg border bg-background text-foreground'>
				{/* The real tabs bar, exactly as story-tabbed-content mounts it */}
				<StoryTabsBar tabs={TABS} activeIndex={tabIndex} onSelect={setTabIndex} contentClassName='px-4' />

				<div className={`flex flex-col ${gap} p-4`}>
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
							<div key={label} className={`${cardClass} ${pad}`}>
								<div className={labelClass}>{label}</div>
								<div className='mt-1 font-semibold' style={figureStyle}>
									{value}
								</div>
							</div>
						))}
					</div>

					{/* Six stacked series, so every chart colour is on screen */}
					<div
						className={heroInverted ? `rounded-lg ${pad}` : `${cardClass} ${pad}`}
						style={heroStyle}
						data-story-inverted={heroInverted ? 'true' : undefined}
					>
						<div className='mb-3 text-sm font-medium'>Users per week by country</div>
						<div className='relative flex h-32 items-end gap-2'>
							{TICKS.map((tick, i) => {
								const columnTotal = BY_COUNTRY.reduce((sum, row) => sum + row[i], 0);
								return (
									<button
										type='button'
										key={tick}
										onMouseEnter={() => setHovered(i)}
										onMouseLeave={() => setHovered(null)}
										onFocus={() => setHovered(i)}
										onBlur={() => setHovered(null)}
										className='flex h-full flex-1 flex-col justify-end gap-[2px]'
										aria-label={`${tick}: ${fmt(columnTotal)} users`}
									>
										{BY_COUNTRY.map((row, c) => (
											<span
												key={COUNTRIES[c]}
												className='block'
												style={{
													height: `${(row[i] / countryMax) * 100}%`,
													background: `var(--chart-${c + 1})`,
													borderTopLeftRadius:
														c === 0 ? `${theme.charts.barRadius}px` : undefined,
													borderTopRightRadius:
														c === 0 ? `${theme.charts.barRadius}px` : undefined,
													opacity: hovered === null || hovered === i ? 1 : 0.45,
												}}
											/>
										))}
									</button>
								);
							})}
							{hovered !== null && (
								<div className='pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm'>
									<div className='font-medium'>{TICKS[hovered]}</div>
									{COUNTRIES.map((country, c) => (
										<div key={country} className='mt-0.5 flex items-center gap-2'>
											<span
												className='size-2 shrink-0 rounded-[2px]'
												style={{ background: `var(--chart-${c + 1})` }}
											/>
											<span className='text-muted-foreground'>{country}</span>
											<span className='ml-auto font-medium'>{fmt(BY_COUNTRY[c][hovered])}</span>
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
						{/* Legend, as ChartLegendContent renders it */}
						<div className='mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1'>
							{COUNTRIES.map((country, c) => (
								<span key={country} className='flex items-center gap-1.5 text-xs text-muted-foreground'>
									<span
										className='size-2 shrink-0 rounded-[2px]'
										style={{ background: `var(--chart-${c + 1})` }}
									/>
									{country}
								</span>
							))}
						</div>
					</div>

					<div className={`${cardClass} ${pad}`}>
						<div className='mb-3 text-sm font-medium'>Trend</div>
						<div
							className='relative'
							onMouseLeave={() => setLineHover(null)}
							onPointerMove={(e) => {
								const box = e.currentTarget.getBoundingClientRect();
								const ratio = (e.clientX - box.left) / box.width;
								setLineHover(
									Math.max(0, Math.min(TICKS.length - 1, Math.round(ratio * (TICKS.length - 1)))),
								);
							}}
						>
							{/*
							 * preserveAspectRatio='none' so the plot fills the card. The default
							 * ('meet') fits a 280x80 viewBox by height, which left the line
							 * floating in the middle third of a much wider box. Strokes are
							 * non-scaling so the horizontal stretch does not thicken them.
							 */}
							<svg
								viewBox='0 0 280 80'
								preserveAspectRatio='none'
								className='h-24 w-full'
								role='img'
								aria-label='Example line chart'
							>
								{(theme.charts.axis === 'minimal' ? [80] : [0, 20, 40, 60, 80]).map((y) => (
									<line
										key={y}
										x1='0'
										x2='280'
										y1={y}
										y2={y}
										stroke='var(--chart-grid)'
										strokeWidth='1'
										vectorEffect='non-scaling-stroke'
									/>
								))}
								{lineHover !== null && (
									<line
										x1={(lineHover * 280) / (TICKS.length - 1)}
										x2={(lineHover * 280) / (TICKS.length - 1)}
										y1='0'
										y2='80'
										stroke='var(--chart-grid)'
										strokeWidth='1'
										vectorEffect='non-scaling-stroke'
									/>
								)}
								{visible.map((key, s2) => (
									<polyline
										key={key}
										fill='none'
										strokeWidth={theme.charts.lineWidth}
										vectorEffect='non-scaling-stroke'
										stroke={`var(--chart-${s2 + 1})`}
										points={SERIES[key]
											.map((v, i) => `${(i * 280) / (TICKS.length - 1)},${80 - (v / max) * 76}`)
											.join(' ')}
									/>
								))}
							</svg>
							{/*
							 * Markers are HTML, not <circle>. The SVG is stretched horizontally
							 * by preserveAspectRatio='none' so the plot can fill the card, and
							 * that turns any circle inside it into an ellipse. non-scaling-stroke
							 * fixes stroke width but not geometry.
							 */}
							{lineHover !== null &&
								visible.map((key, s2) => (
									<span
										key={key}
										className='pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full'
										style={{
											left: `${(lineHover / (TICKS.length - 1)) * 100}%`,
											top: `${((80 - (SERIES[key][lineHover] / max) * 76) / 80) * 100}%`,
											background: `var(--chart-${s2 + 1})`,
											boxShadow: '0 0 0 2px var(--card)',
										}}
									/>
								))}
							{lineHover !== null && (
								<div
									className='pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm'
									style={{ left: `${(lineHover / (TICKS.length - 1)) * 100}%` }}
								>
									<div className='font-medium'>{TICKS[lineHover]}</div>
									{visible.map((key, s2) => (
										<div key={key} className='mt-0.5 flex items-center gap-2'>
											<span
												className='size-2 shrink-0 rounded-[2px]'
												style={{ background: `var(--chart-${s2 + 1})` }}
											/>
											<span className='text-muted-foreground'>{key}</span>
											<span className='ml-auto font-medium'>{fmt(SERIES[key][lineHover])}</span>
										</div>
									))}
								</div>
							)}
						</div>
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

					{/* The real table component, so type and rules are themed like a story's */}
					<DataTableCard
						title='Users by country'
						columns={TABLE_COLUMNS}
						data={COUNTRIES.map((country, c) => ({
							Country: country,
							Users: BY_COUNTRY[c].reduce((a, b) => a + b, 0),
							Messages: Math.round(BY_COUNTRY[c].reduce((a, b) => a + b, 0) * 2.4),
							Share: `${((BY_COUNTRY[c].reduce((a, b) => a + b, 0) / tableTotal) * 100).toFixed(1)}%`,
						}))}
						maxRowsBeforePagination={10}
					/>

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
