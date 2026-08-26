import { storyThemeToCssVars } from '@nao/shared/story-theme';
import type { StoryTheme } from '@nao/shared/story-theme';
import type { CSSProperties } from 'react';

/**
 * A miniature story rendered in a candidate theme.
 *
 * Static on purpose. The admin is deciding whether a look is right, not reading
 * data, so this shows the pieces a template actually controls - heading face,
 * filter shape, card treatment, chart palette, table rules - without needing a
 * real story or a query to run.
 */
export function StoryThemePreview({ theme }: { theme: StoryTheme }) {
	const style = storyThemeToCssVars(theme) as CSSProperties;
	const radius = `${theme.shape.radius}px`;
	const controlRadius =
		theme.shape.controlShape === 'pill' ? '9999px' : theme.shape.controlShape === 'square' ? '0px' : radius;
	const bars = [72, 46, 88, 61, 39, 80, 54];

	return (
		<div
			style={{ ...style, background: theme.surfaces.page, borderRadius: radius }}
			className='border border-border p-5 overflow-hidden'
		>
			<p
				style={{
					fontFamily: theme.typography.headingFont,
					letterSpacing: `${theme.typography.headingTracking}em`,
					color: theme.ink.primary,
					fontSize: `${1.35 * theme.typography.scale}rem`,
				}}
				className='font-semibold leading-tight'
			>
				Weekly active users
			</p>
			<p style={{ fontFamily: theme.typography.bodyFont, color: theme.ink.secondary }} className='text-sm mt-1'>
				How a story will look with this design system.
			</p>

			{/* Filter bar */}
			<div className='flex flex-wrap gap-2 mt-4'>
				{['All', 'Deployed', 'Local'].map((label, i) => (
					<span
						key={label}
						style={{
							borderRadius: controlRadius,
							background: i === 0 ? theme.accent : theme.surfaces.sunken,
							color: i === 0 ? theme.accentInk : theme.ink.secondary,
							fontFamily: theme.typography.bodyFont,
							border: `1px solid ${i === 0 ? theme.accent : theme.shape.border}`,
						}}
						className='text-xs px-3 py-1.5'
					>
						{label}
					</span>
				))}
			</div>

			{/* KPI tiles + chart */}
			<div className='grid grid-cols-3 gap-3 mt-4'>
				{[
					['Latest week', '3,044'],
					['Average', '3,275'],
					['Peak', '5,946'],
				].map(([label, value]) => (
					<div
						key={label}
						style={{
							background: theme.surfaces.card,
							borderRadius: radius,
							border:
								theme.shape.elevation === 'bordered'
									? `1px solid ${theme.shape.border}`
									: '1px solid transparent',
							boxShadow:
								theme.shape.elevation === 'shadowed' ? '0 8px 24px -16px rgb(0 0 0 / 25%)' : 'none',
						}}
						className='p-3'
					>
						<div
							style={{ color: theme.ink.muted, fontFamily: theme.typography.bodyFont }}
							className='text-[10px] uppercase tracking-wide'
						>
							{label}
						</div>
						<div
							style={{ color: theme.ink.primary, fontFamily: theme.typography.headingFont }}
							className='text-lg font-semibold mt-0.5'
						>
							{value}
						</div>
					</div>
				))}
			</div>

			<div
				style={{
					background: theme.surfaces.card,
					borderRadius: radius,
					border:
						theme.shape.elevation === 'bordered'
							? `1px solid ${theme.shape.border}`
							: '1px solid transparent',
					boxShadow: theme.shape.elevation === 'shadowed' ? '0 8px 24px -16px rgb(0 0 0 / 25%)' : 'none',
				}}
				className='mt-3 p-4'
			>
				<div className='flex items-end gap-2 h-24'>
					{bars.map((h, i) => (
						<div
							key={i}
							style={{
								height: `${h}%`,
								background: theme.charts.series[i % theme.charts.series.length],
								borderRadius: theme.shape.controlShape === 'square' ? 0 : '3px 3px 0 0',
							}}
							className='flex-1'
						/>
					))}
				</div>
				<div style={{ borderTop: `1px solid ${theme.charts.grid}` }} className='mt-2 pt-2'>
					<div className='flex gap-3 flex-wrap'>
						{theme.charts.series.slice(0, 5).map((c) => (
							<span
								key={c}
								style={{ color: theme.ink.muted, fontFamily: theme.typography.bodyFont }}
								className='inline-flex items-center gap-1.5 text-[10px]'
							>
								<span style={{ background: c }} className='size-2 rounded-[2px]' />
								{c}
							</span>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
