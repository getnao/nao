import { EyeOff } from 'lucide-react';
import { useState } from 'react';

import type { QuickFilter } from '@/components/monitoring/stories-data-grid';
import { StoriesDataGrid } from '@/components/monitoring/stories-data-grid';
import { Bars, Line, SparkTile } from '@/components/story-monitoring-kpis';
import { StoryMonitoringDialog } from '@/components/story-monitoring-dialog';
import { Button } from '@/components/ui/button';
import { formatInteger, formatPercent } from '@/lib/monitoring-format';
import { buildGridStories, formatUsd } from '@/lib/story-monitoring-mock';

const VIEWS_PER_DAY = [310, 342, 120, 98, 388, 402, 371, 344, 362, 131, 104, 412, 398, 401];
const READERS_PER_DAY = [61, 66, 22, 18, 71, 74, 69, 63, 68, 24, 20, 76, 73, 75];
const COST_PER_DAY = [2.1, 2.3, 2.0, 2.2, 2.4, 2.2, 2.1, 2.3, 2.2, 2.3, 4.1, 4.7, 5.6, 6.8];
const SUCCESS_PER_DAY = [99.1, 99.4, 99.0, 99.2, 98.9, 99.3, 99.2, 99.1, 98.8, 99.0, 97.2, 96.4, 97.9, 98.1];
const GRID_STORIES = buildGridStories();
const UNREAD = GRID_STORIES.filter((story) => story.status === 'live' && story.views === 0);
const WEEK_COST = GRID_STORIES.reduce((sum, story) => sum + story.costPerDay * 7, 0);
const OVER_LIMIT = GRID_STORIES.filter((story) => story.costPerDay > story.limit).length;
const RUNS_PER_DAY: Record<string, number> = {
	'Every 15 min': 96,
	'Every 30 min': 48,
	'Every hour': 24,
	'Every 6 hours': 4,
	'Every day 7:00': 1,
	'Weekdays 9:00': 0.7,
};

/** Admin tab: how stories are used, which ones cost money for nobody, and the runs that cost the most. */
export function StoriesMonitoring() {
	const [quickFilters, setQuickFilters] = useState<QuickFilter[]>(
		new URLSearchParams(window.location.search).get('quick') === 'unread' ? ['unread'] : [],
	);
	const [openStoryTitle, setOpenStoryTitle] = useState<string | null>(null);

	return (
		<>
			<StoriesKpis />
			<UnreadStoriesCallout onShow={() => setQuickFilters(['unread'])} />
			<StoriesCard
				quickFilters={quickFilters}
				onQuickFiltersChange={setQuickFilters}
				onOpenStory={setOpenStoryTitle}
			/>
			<StoryMonitoringDialog
				open={openStoryTitle !== null}
				onOpenChange={(open) => !open && setOpenStoryTitle(null)}
				storyTitle={openStoryTitle ?? undefined}
			/>
		</>
	);
}

function StoriesKpis() {
	return (
		<div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
			<SparkTile
				label='Story views'
				value='4,483'
				detail={`${GRID_STORIES.filter((story) => story.views > 0).length} stories read of ${GRID_STORIES.length}`}
				delta='+12%'
			>
				<Bars values={VIEWS_PER_DAY} />
			</SparkTile>
			<SparkTile label='Readers' value='164' detail='41% of members' delta='+6%'>
				<Line values={READERS_PER_DAY} />
			</SparkTile>
			<SparkTile label='Refresh success' value='98.6%' detail='61 failed of 4,412' delta='-0.7 pt' deltaBad>
				<Line values={SUCCESS_PER_DAY} />
			</SparkTile>
			<SparkTile
				label='Story LLM cost'
				value={formatUsd(WEEK_COST)}
				detail={`${OVER_LIMIT} stories over their limit`}
				delta='+38%'
				deltaBad
			>
				<Bars values={COST_PER_DAY} />
			</SparkTile>
		</div>
	);
}

function UnreadStoriesCallout({ onShow }: { onShow: () => void }) {
	const cost = UNREAD.reduce((sum, story) => sum + story.costPerDay * 7, 0);
	const refreshes = UNREAD.reduce((sum, story) => sum + (RUNS_PER_DAY[story.schedule] ?? 0) * 7, 0);
	return (
		<div className='flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm'>
			<EyeOff className='size-4 shrink-0 text-amber-600 dark:text-amber-500' />
			<span className='min-w-0 flex-1'>
				<span className='font-medium'>
					{UNREAD.length} live stories refreshed {formatInteger(refreshes)} times with no reader
				</span>
				<span className='text-muted-foreground'>
					{' '}
					· {formatUsd(cost)} this period, {formatPercent(cost / WEEK_COST)} of story LLM cost
				</span>
			</span>
			<Button variant='outline' size='sm' onClick={onShow}>
				Show them
			</Button>
		</div>
	);
}

function StoriesCard({
	quickFilters,
	onQuickFiltersChange,
	onOpenStory,
}: {
	quickFilters: QuickFilter[];
	onQuickFiltersChange: (filters: QuickFilter[]) => void;
	onOpenStory: (storyTitle: string) => void;
}) {
	return (
		<section className='flex min-w-0 flex-col gap-3 rounded-xl border bg-background p-4'>
			<StoriesDataGrid
				quickFilters={quickFilters}
				onQuickFiltersChange={onQuickFiltersChange}
				onOpenStory={(story) => onOpenStory(story.title)}
			/>
		</section>
	);
}
