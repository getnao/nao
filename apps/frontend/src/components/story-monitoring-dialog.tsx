import * as SheetPrimitive from '@radix-ui/react-dialog';
import { RefreshCw, Send, X } from 'lucide-react';
import { useState } from 'react';

import type { RefreshSchedule } from '@/components/story-refresh-grid';
import { StoryDeliveryGrid } from '@/components/story-delivery-grid';
import { StoryRefreshGrid } from '@/components/story-refresh-grid';
import { StoryMonitoringKpis } from '@/components/story-monitoring-kpis';
import { Button } from '@/components/ui/button';
import { TabBar } from '@/components/ui/tab-bar';
import { cn } from '@/lib/utils';

type StoryMonitoringTab = 'refreshes' | 'deliveries' | 'audience';

export function StoryMonitoringDialog({
	open,
	onOpenChange,
	initialTab = 'refreshes',
	storyTitle,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initialTab?: StoryMonitoringTab;
	/** Shown when the panel opens away from the story, e.g. from Settings › Monitoring. */
	storyTitle?: string;
}) {
	const [tab, setTab] = useState<StoryMonitoringTab>(initialTab);
	const [seenTabs, setSeenTabs] = useState<Set<StoryMonitoringTab>>(() => new Set([initialTab]));
	const openTab = (nextTab: StoryMonitoringTab) => {
		setSeenTabs((previous) => new Set(previous).add(nextTab));
		setTab(nextTab);
	};

	return (
		<SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<SheetPrimitive.Portal>
				<SheetPrimitive.Overlay className='data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/20' />
				<SheetPrimitive.Content className='data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right fixed inset-y-0 right-0 z-50 flex w-full max-w-[780px] flex-col border-l bg-background shadow-2xl duration-300 outline-none'>
					<header className='flex items-start justify-between gap-2 px-6 pt-5'>
						<div className='flex min-w-0 flex-col gap-0.5'>
							{storyTitle && <span className='truncate text-xs text-muted-foreground'>Monitoring</span>}
							<SheetPrimitive.Title className='truncate text-lg font-semibold'>
								{storyTitle ?? 'Monitoring'}
							</SheetPrimitive.Title>
							<SheetPrimitive.Description className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
								<span className='flex items-center gap-1'>
									<RefreshCw className='size-3' />
									refreshed 2 min ago · next at 10:15
								</span>
								<span className='flex items-center gap-1'>
									<Send className='size-3' />
									delivered this morning · next Fri, Dec 4, 8:00
								</span>
							</SheetPrimitive.Description>
						</div>
						<SheetPrimitive.Close asChild>
							<Button variant='ghost' size='icon-sm' aria-label='Close'>
								<X className='size-4' />
							</Button>
						</SheetPrimitive.Close>
					</header>
					<TabBar
						idBase='story-monitoring'
						activeTab={tab}
						onTabChange={openTab}
						className='mt-3 px-6 shadow-[inset_0_-1px_0_var(--color-border)]'
						tabs={[
							{
								id: 'refreshes',
								label: <TabLabel label='Refreshes' hasNews={!seenTabs.has('refreshes')} />,
							},
							{
								id: 'deliveries',
								label: <TabLabel label='Deliveries' hasNews={!seenTabs.has('deliveries')} />,
							},
							{ id: 'audience', label: 'Audience' },
						]}
					/>
					<div className='min-h-0 flex-1 overflow-y-auto px-6 py-4'>
						{tab === 'refreshes' && <RefreshesTab />}
						{tab === 'deliveries' && <DeliveriesTab />}
						{tab === 'audience' && <AudienceTab />}
					</div>
				</SheetPrimitive.Content>
			</SheetPrimitive.Portal>
		</SheetPrimitive.Root>
	);
}

/** A dot instead of a count: something failed there since the editor last looked. */
function TabLabel({ label, hasNews }: { label: string; hasNews: boolean }) {
	return (
		<span className='relative'>
			{label}
			{hasNews && (
				<span
					aria-label='New failures'
					className='absolute -top-0.5 -right-2.5 size-1.5 rounded-full bg-destructive'
				/>
			)}
		</span>
	);
}

function RefreshesTab() {
	const [schedule, setSchedule] = useState<RefreshSchedule>('every_5_min');
	return (
		<div className='flex flex-col gap-3'>
			<StoryMonitoringKpis />
			<div className='flex items-center gap-2 text-xs text-muted-foreground'>
				<span>Mock: preview with a story refreshing</span>
				{(
					[
						['every_5_min', 'Every 5 min'],
						['hourly', 'Hourly'],
						['every_6_hours', '4× a day'],
						['weekdays', 'Weekdays 9/12/17'],
						['daily', 'Daily'],
					] as const
				).map(([id, label]) => (
					<button
						key={id}
						type='button'
						onClick={() => setSchedule(id)}
						className={cn(
							'rounded-full border border-dashed px-2.5 py-1',
							schedule === id && 'border-solid bg-accent font-medium text-foreground',
						)}
					>
						{label}
					</button>
				))}
			</div>
			<StoryRefreshGrid key={schedule} schedule={schedule} />
		</div>
	);
}

function DeliveriesTab() {
	return (
		<div className='flex flex-col gap-3'>
			<StoryDeliveryGrid />
		</div>
	);
}

function AudienceTab() {
	return (
		<div className='flex h-60 flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-sm text-muted-foreground'>
			<span className='font-medium text-foreground'>Today's “Analytics” dialog, moved here as is</span>
			<span>Views, downloads, forks, favorites, feedback per person.</span>
		</div>
	);
}
