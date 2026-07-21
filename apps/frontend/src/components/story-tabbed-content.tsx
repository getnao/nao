import { useMemo, useState } from 'react';
import { parseStoryTabs, stripStoryTabsMarkup } from '@nao/shared/story-tabs';
import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import { StoryTabsBar } from '@/components/side-panel/story-tabs-bar';
import { SegmentList } from '@/components/story-rendering';

interface StoryTabbedContentProps {
	code: string;
	renderChart: (chart: ParsedChartBlock, key: number) => React.ReactNode;
	renderTable: (table: ParsedTableBlock, key: number) => React.ReactNode;
	contentClassName?: string;
}

export function StoryTabbedContent({
	code,
	renderChart,
	renderTable,
	contentClassName = 'max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4',
}: StoryTabbedContentProps) {
	const tabs = useMemo(() => parseStoryTabs(code), [code]);
	const [activeIndex, setActiveIndex] = useState(0);
	const isTabbed = Boolean(tabs?.length);
	const activeTabIndex = tabs?.length ? Math.min(activeIndex, tabs.length - 1) : 0;
	const activeCode = isTabbed && tabs ? tabs[activeTabIndex].innerCode : stripStoryTabsMarkup(code);
	const segments = useMemo(() => splitCodeIntoSegments(activeCode), [activeCode]);

	return (
		<div className='flex flex-1 min-h-0 flex-col'>
			{isTabbed && tabs && (
				<StoryTabsBar
					tabs={tabs.map((tab) => ({ title: tab.title }))}
					activeIndex={activeTabIndex}
					onSelect={setActiveIndex}
					contentClassName='mx-auto w-full max-w-5xl px-4 md:px-8'
				/>
			)}
			<div className='flex-1 overflow-auto'>
				<div className={contentClassName}>
					<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
				</div>
			</div>
		</div>
	);
}
