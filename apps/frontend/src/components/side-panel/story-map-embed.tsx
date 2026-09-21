import { FoldHorizontal, Pencil, UnfoldHorizontal } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { mapBlockToInput } from '@nao/shared/story-segments';
import { StoryEmbedFallback } from './story-embed-fallback';
import type { ParsedMapBlock } from '@nao/shared/story-segments';

import { StoryMapRender } from '@/components/story-map-embed';
import { MapConfigEditDialog } from '@/components/tool-calls/display-map-edit-dialog';
import { Button } from '@/components/ui/button';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { useIsInStoryGrid } from '@/contexts/story-grid';
import { useStoryMapEdit } from '@/contexts/story-map-edit';
import { useBreakoutStyle } from '@/hooks/use-breakout-width';
import { useSourceQuery } from '@/hooks/use-source-query';
import { cn } from '@/lib/utils';

export const StoryMapEmbed = memo(function StoryMapEmbed({
	map,
	dragHandle,
}: {
	map: ParsedMapBlock;
	dragHandle?: React.ReactNode;
}) {
	const embedData = useStoryEmbedData();
	const embedSourceData = embedData?.[map.queryId];
	const { sourceData: agentSourceData } = useSourceQuery(embedSourceData ? undefined : map.queryId);
	const sourceData = embedSourceData ?? agentSourceData;

	if (!sourceData?.data || sourceData.data.length === 0) {
		return (
			<StoryEmbedFallback dragHandle={dragHandle}>Map data unavailable (query: {map.queryId})</StoryEmbedFallback>
		);
	}

	return (
		<StoryMapEmbedShell map={map} dragHandle={dragHandle}>
			<StoryMapRender map={map} data={sourceData.data} />
		</StoryMapEmbedShell>
	);
});

interface StoryMapEmbedShellProps {
	map: ParsedMapBlock;
	dragHandle?: React.ReactNode;
	allowExpand?: boolean;
	children: React.ReactNode;
}

export function StoryMapEmbedShell({ map, dragHandle, allowExpand = false, children }: StoryMapEmbedShellProps) {
	const edit = useStoryMapEdit();
	const isInGrid = useIsInStoryGrid();
	const [isEditOpen, setIsEditOpen] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);
	const slotRef = useRef<HTMLDivElement>(null);
	const canExpand = allowExpand && !isInGrid;
	const breakoutStyle = useBreakoutStyle(slotRef, canExpand && isExpanded);
	const config = useMemo(() => mapBlockToInput(map), [map]);
	const canEdit = Boolean(edit && map.rawTag);
	const showHeader = Boolean(map.title || dragHandle || canEdit || canExpand);

	return (
		<div ref={slotRef} className='my-2'>
			<div className='flex flex-col gap-2 transition-[margin,width] duration-200 ease-out' style={breakoutStyle}>
				{showHeader && (
					<div className='flex items-center justify-between gap-2'>
						{map.title ? (
							<span className='text-sm font-medium text-foreground flex-1 min-w-0 truncate'>
								{map.title}
							</span>
						) : (
							<div className='flex-1' />
						)}
						<div className='flex shrink-0 items-center gap-1'>
							{dragHandle}
							{canExpand && (
								<Button
									variant='ghost-muted'
									size='icon-xs'
									onClick={() => setIsExpanded((value) => !value)}
									title={isExpanded ? 'Collapse width' : 'Expand width'}
									className={cn(
										'shrink-0 hover:bg-accent hover:rounded-full',
										isExpanded && 'bg-accent rounded-full',
									)}
								>
									{isExpanded ? (
										<FoldHorizontal className='size-3.5' />
									) : (
										<UnfoldHorizontal className='size-3.5' />
									)}
								</Button>
							)}
							{canEdit && (
								<Button
									variant='ghost-muted'
									size='icon-xs'
									onClick={() => setIsEditOpen(true)}
									title='Edit map'
									className='shrink-0 hover:bg-accent hover:rounded-full'
								>
									<Pencil className='size-3.5' />
								</Button>
							)}
						</div>
					</div>
				)}
				{children}
				{canEdit && edit && map.rawTag && (
					<MapConfigEditDialog
						open={isEditOpen}
						onOpenChange={setIsEditOpen}
						config={config}
						isSaving={edit.isSaving}
						onSave={(next) => edit.saveMap(map.rawTag!, next)}
						description={edit.saveDescription}
					/>
				)}
			</div>
		</div>
	);
}
