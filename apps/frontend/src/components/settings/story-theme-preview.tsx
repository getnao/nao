import { StoryBrandMark } from '@nao/shared/story-brand-mark';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { DEFAULT_STORY_THEME_PAIR, sameThemePair, showsBrandIdentity } from '@nao/shared/story-theme';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { describeStoryThemeSources } from '@nao/shared/story-theme-generation';
import type { StoryFilterSelection } from '@nao/shared/sql-template';
import type { ParsedFilterBlock } from '@nao/shared/story-segments';
import type { StoryTheme, StoryThemePair } from '@nao/shared/story-theme';
import type { StoryThemeGeneration } from '@nao/shared/story-theme-generation';

import type { QueryDataMap } from '@/components/story-embeds';
import {
	generationToSave,
	STORY_THEME_MODE_OPTIONS,
	useInvalidateStoryTheme,
	useStoryThemeEditor,
} from '@/components/settings/story-theme-editor-context';
import { StoryThemeVersionMenu } from '@/components/settings/story-theme-version-menu';
import { StoryTabsBar } from '@/components/side-panel/story-tabs-bar';
import { StoryBlock, StoryTableFrame } from '@/components/story-block';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { StoryFilterBar } from '@/components/story-filter-bar';
import { SegmentList } from '@/components/story-rendering';
import { StoryThemeProvider } from '@/components/story-theme-provider';
import { Button } from '@/components/ui/button';
import { IconSegmentedToggle } from '@/components/ui/icon-segmented-toggle';
import { Spinner } from '@/components/ui/spinner';
import { useSidePanel } from '@/contexts/side-panel';
import { usePermissions } from '@/hooks/use-permissions';
import { trpc } from '@/main';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const REGIONS = [
	{ key: 'north_america', label: 'North America' },
	{ key: 'europe', label: 'Europe' },
	{ key: 'asia_pacific', label: 'Asia Pacific' },
];
const REVENUE_BY_REGION = [
	[420, 465, 510, 488, 552, 601],
	[310, 328, 355, 372, 398, 421],
	[180, 205, 232, 260, 291, 330],
];

const PREVIEW_DATA: QueryDataMap = {
	revenue_by_region: {
		columns: ['month', ...REGIONS.map((region) => region.key)],
		data: MONTHS.map((month, index) => ({
			month,
			...Object.fromEntries(
				REGIONS.map((region, regionIndex) => [region.key, REVENUE_BY_REGION[regionIndex][index]]),
			),
		})),
	},
	revenue_total: {
		columns: ['month', 'revenue'],
		data: MONTHS.map((month, index) => ({
			month,
			revenue: REVENUE_BY_REGION.reduce((sum, series) => sum + series[index], 0),
		})),
	},
	kpi_metrics: {
		columns: ['month', 'total_revenue', 'new_customers', 'average_order'],
		data: MONTHS.map((month, index) => ({
			month,
			total_revenue: REVENUE_BY_REGION.reduce((sum, series) => sum + series[index], 0) * 1000,
			new_customers: 180 + index * 24,
			average_order: 312 + index * 9,
		})),
	},
	region_totals: {
		columns: ['Region', 'Revenue', 'Growth'],
		data: REGIONS.map((region, regionIndex) => {
			const series = REVENUE_BY_REGION[regionIndex];
			const growth = ((series[series.length - 1] / series[0] - 1) * 100).toFixed(1);
			return {
				Region: region.label,
				Revenue: series.reduce((sum, value) => sum + value, 0),
				Growth: `${growth}%`,
			};
		}),
	},
};

const seriesAttribute = (series: { key: string; label: string }[]) =>
	JSON.stringify(series.map((entry) => ({ data_key: entry.key, label: entry.label })));

const kpiTag = (key: string, label: string) =>
	`<chart query_id="kpi_metrics" chart_type="kpi_card" x_axis_key="month" series='${seriesAttribute([{ key, label }])}' />`;

const PREVIEW_TITLE = 'Revenue overview';
const PREVIEW_DESCRIPTION =
	'The same header, headings, prose, KPI tiles, filters, charts and tables a custom story is built from, rendered in this theme.';
const PREVIEW_TABS = ['Overview', 'Regions', 'Products'].map((title) => ({ title }));
const PREVIEW_FILTERS: ParsedFilterBlock[] = [
	{
		id: 'region',
		label: 'Region',
		filterType: 'multi_select',
		options: REGIONS.map((region) => region.label),
	},
	{ id: 'channel', label: 'Channel', filterType: 'select', options: ['Online', 'Retail', 'Partners'] },
	{ id: 'period', label: 'Period', filterType: 'date_range' },
];
const PREVIEW_FILTER_SELECTIONS: Record<string, StoryFilterSelection> = {
	region: ['Europe'],
	channel: '',
	period: [],
};
const CLEARED_FILTER_SELECTIONS: Record<string, StoryFilterSelection> = { region: [], channel: '', period: [] };

const PREVIEW_CODE = [
	'<grid cols="3">',
	'',
	kpiTag('total_revenue', 'Total revenue'),
	'',
	kpiTag('new_customers', 'New customers'),
	'',
	kpiTag('average_order', 'Average order'),
	'',
	'</grid>',
	'',
	'## What changed this quarter',
	'',
	'- Every region grew month over month, with Asia Pacific accelerating fastest.',
	'- June was the strongest month on record for total revenue.',
	'',
	`<chart query_id="revenue_by_region" chart_type="bar" x_axis_key="month" series='${seriesAttribute(REGIONS)}' title="Revenue by region" />`,
	'',
	`<chart query_id="revenue_total" chart_type="line" x_axis_key="month" series='${seriesAttribute([{ key: 'revenue', label: 'Revenue' }])}' title="Total revenue" />`,
	'',
	'<table query_id="region_totals" title="Regions" />',
].join('\n');

export function StoryThemePreview({ theme }: { theme: StoryTheme }) {
	const segments = useMemo(() => splitCodeIntoSegments(PREVIEW_CODE), []);

	return (
		<StoryThemeProvider theme={theme}>
			<div className='min-h-full bg-background text-foreground'>
				<PreviewBrandHeader brand={theme.brand} />
				<div className='mx-auto flex max-w-5xl flex-col gap-4 p-4 md:p-8'>
					<div className='flex flex-col gap-2'>
						<h1>{PREVIEW_TITLE}</h1>
						<p className='max-w-[720px] opacity-80'>{PREVIEW_DESCRIPTION}</p>
					</div>
					<PreviewFilterBar />
					<SegmentList
						segments={segments}
						renderChart={(chart) => (
							<StoryBlock>
								<StoryChartEmbed chart={chart} queryData={PREVIEW_DATA} />
							</StoryBlock>
						)}
						renderTable={(table) => (
							<StoryTableFrame>
								<StoryTableEmbed table={table} queryData={PREVIEW_DATA} />
							</StoryTableFrame>
						)}
						renderMap={() => null}
					/>
				</div>
			</div>
		</StoryThemeProvider>
	);
}

function PreviewBrandHeader({ brand }: { brand: StoryTheme['brand'] }) {
	const [activeTab, setActiveTab] = useState(0);
	const isBand = brand.header === 'band';
	return (
		<header className='flex flex-col'>
			<div
				className={isBand ? undefined : 'bg-card'}
				style={{ background: isBand ? 'var(--story-header-bg)' : undefined, color: 'var(--story-header-fg)' }}
			>
				<div className='nao-brand-header__bar mx-auto w-full max-w-5xl px-4 py-3 md:px-8'>
					{showsBrandIdentity(brand) ? <StoryBrandMark brand={brand} /> : <span />}
				</div>
			</div>
			<StoryTabsBar
				tabs={PREVIEW_TABS}
				activeIndex={activeTab}
				onSelect={setActiveTab}
				showAddTab
				containerClassName='bg-card'
				contentClassName='mx-auto w-full max-w-5xl px-4 md:px-8'
			/>
		</header>
	);
}

function PreviewFilterBar() {
	const [selections, setSelections] = useState(PREVIEW_FILTER_SELECTIONS);
	return (
		<StoryFilterBar
			filters={PREVIEW_FILTERS}
			selections={selections}
			onSelectionChange={(filterId, selection) =>
				setSelections((current) => ({ ...current, [filterId]: selection }))
			}
			onClear={() => setSelections(CLEARED_FILTER_SELECTIONS)}
		/>
	);
}

export function StoryThemePreviewPanel() {
	const {
		theme,
		setTheme,
		mode,
		setMode,
		viewingVersionIndex,
		setViewingVersionIndex,
		pendingGeneration,
		setPendingGeneration,
	} = useStoryThemeEditor();
	const { close } = useSidePanel();
	const { isAdmin } = usePermissions();
	const invalidateStoryTheme = useInvalidateStoryTheme();
	const versionsQuery = useQuery(trpc.storyTheme.listVersions.queryOptions());
	const versions = useMemo(() => versionsQuery.data?.versions ?? [], [versionsQuery.data?.versions]);
	const slots = useMemo(() => buildPreviewSlots(versions, theme), [versions, theme]);
	const totalVersions = slots.length;
	const latestIndex = totalVersions - 1;
	const currentIndex = Math.min(viewingVersionIndex ?? latestIndex, latestIndex);
	const current = slots[currentIndex];
	const isViewingLatest = currentIndex === latestIndex;
	const previewTheme = theme ? current.theme[mode] : null;
	const currentVersion = currentIndex + 1;
	const pendingRecord = theme ? generationToSave(pendingGeneration, theme) : null;
	const currentGeneration = current.kind === 'pending' ? pendingRecord : current.generation;
	const currentSources = currentGeneration ? describeStoryThemeSources(currentGeneration.sources) : null;

	useEffect(() => {
		if (viewingVersionIndex !== null && viewingVersionIndex >= latestIndex) {
			setViewingVersionIndex(null);
		}
	}, [latestIndex, setViewingVersionIndex, viewingVersionIndex]);

	const restore = useMutation({
		...trpc.storyTheme.restoreVersion.mutationOptions(),
		onSuccess: async (result) => {
			setTheme(result.theme);
			setPendingGeneration(null);
			await invalidateStoryTheme();
		},
	});

	const versionEntries = slots.map((slot, index) => ({
		label: slotLabel(slot, index + 1),
		date: slotDate(slot, pendingRecord),
		generation: slot.kind === 'pending' ? pendingRecord : slot.generation,
	}));

	const selectVersion = (index: number) => setViewingVersionIndex(index >= latestIndex ? null : index);

	const restoreCurrent = () => {
		if (current.kind === 'saved') {
			restore.mutate({ version: current.version });
			return;
		}
		setTheme(current.theme);
		setPendingGeneration(null);
	};

	return (
		<div className='flex h-full flex-col'>
			<div className='flex items-center gap-2 border-b px-4 py-2'>
				<Button
					variant='ghost'
					size='icon-sm'
					className='mr-2 hover:rounded-full'
					onClick={close}
					aria-label='Close preview'
				>
					<X className='size-3.5' strokeWidth={2.25} />
				</Button>
				<div className='flex min-w-0 flex-1 flex-col'>
					<span className='truncate text-sm font-medium'>{slotLabel(current, currentVersion)}</span>
					{currentSources && (
						<span className='truncate text-xs text-muted-foreground' title={currentSources}>
							From {currentSources}
						</span>
					)}
				</div>
				<IconSegmentedToggle
					options={STORY_THEME_MODE_OPTIONS}
					value={mode}
					onValueChange={setMode}
					className='shrink-0'
				/>
				<StoryThemeVersionMenu entries={versionEntries} currentIndex={currentIndex} onSelect={selectVersion} />
			</div>
			{!isViewingLatest && (
				<div className='flex items-center justify-between border-b bg-muted/40 px-4 py-2'>
					<span className='text-xs text-muted-foreground'>
						Viewing v{currentVersion} of {totalVersions}
					</span>
					{isAdmin && (
						<Button
							variant='outline'
							size='sm'
							onClick={restoreCurrent}
							disabled={restore.isPending}
							className='gap-1.5'
						>
							<RotateCcw className='size-3' strokeWidth={2.25} />
							<span>{restore.isPending ? 'Restoring…' : 'Restore'}</span>
						</Button>
					)}
				</div>
			)}
			<div className='min-h-0 flex-1 overflow-auto'>
				{previewTheme ? (
					<StoryThemePreview theme={previewTheme} />
				) : (
					<div className='flex h-full items-center justify-center'>
						<Spinner className='size-5' />
					</div>
				)}
			</div>
		</div>
	);
}

type PreviewSlot =
	| { kind: 'default'; theme: StoryThemePair; generation: null }
	| {
			kind: 'saved';
			theme: StoryThemePair;
			version: number;
			generation: StoryThemeGeneration | null;
			createdAt: Date;
	  }
	| { kind: 'pending'; theme: StoryThemePair; generation: null };

function buildPreviewSlots(
	versions: { version: number; theme: StoryThemePair; generation: StoryThemeGeneration | null; createdAt: Date }[],
	draft: StoryThemePair | null,
): PreviewSlot[] {
	const saved: PreviewSlot[] =
		versions.length > 0
			? versions.map((entry) => ({
					kind: 'saved',
					theme: entry.theme,
					version: entry.version,
					generation: entry.generation,
					createdAt: new Date(entry.createdAt),
				}))
			: [{ kind: 'default', theme: DEFAULT_STORY_THEME_PAIR, generation: null }];
	const baseline = saved[saved.length - 1].theme;
	if (draft && !sameThemePair(draft, baseline)) {
		return [...saved, { kind: 'pending', theme: draft, generation: null }];
	}
	return saved;
}

function slotDate(slot: PreviewSlot, pending: StoryThemeGeneration | null): Date | null {
	if (slot.kind === 'saved') {
		return slot.createdAt;
	}
	return slot.kind === 'pending' && pending ? new Date(pending.generatedAt) : null;
}

function slotLabel(slot: PreviewSlot, position: number): string {
	switch (slot.kind) {
		case 'pending':
			return `Pending v${position} · unsaved`;
		case 'saved':
			return `Theme ${position}`;
		case 'default':
			return 'Default theme';
	}
}
