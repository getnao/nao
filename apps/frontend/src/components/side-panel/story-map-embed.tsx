import { FoldHorizontal, Pencil, UnfoldHorizontal } from 'lucide-react';
import { memo, useMemo, useRef, useState } from 'react';
import { StoryEmbedFallback } from './story-embed-fallback';
import type { ParsedMapBlock } from '@nao/shared/story-segments';
import type { displayMap } from '@nao/shared/tools';

import { StoryMapRender } from '@/components/story-map-embed';
import { MapConfigEditDialog } from '@/components/tool-calls/display-map-edit-dialog';
import { Button } from '@/components/ui/button';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { useStoryMapEdit } from '@/contexts/story-map-edit';
import { useBreakoutStyle } from '@/hooks/use-breakout-width';
import { findLatestExecuteSqlInMessages } from '@/lib/execute-sql-messages';
import { cn } from '@/lib/utils';

export const StoryMapEmbed = memo(function StoryMapEmbed({
	map,
	dragHandle,
}: {
	map: ParsedMapBlock;
	dragHandle?: React.ReactNode;
}) {
	const agent = useOptionalAgentContext();
	const embedData = useStoryEmbedData();

	const sourceData = useMemo(() => {
		const fromEmbedData = embedData?.[map.queryId];
		if (fromEmbedData) {
			return fromEmbedData;
		}

		return findLatestExecuteSqlInMessages(agent?.messages ?? [], map.queryId)?.output ?? null;
	}, [embedData, agent?.messages, map.queryId]);

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
	const [isEditOpen, setIsEditOpen] = useState(false);
	const [isExpanded, setIsExpanded] = useState(false);
	const slotRef = useRef<HTMLDivElement>(null);
	const breakoutStyle = useBreakoutStyle(slotRef, allowExpand && isExpanded);
	const config = useMemo(() => mapBlockToConfig(map), [map]);
	const canEdit = Boolean(edit && map.rawTag);
	const showHeader = Boolean(map.title || dragHandle || canEdit || allowExpand);

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
							{allowExpand && (
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

function mapBlockToConfig(map: ParsedMapBlock): displayMap.Input {
	return {
		query_id: map.queryId,
		map_type: (map.mapType || 'points') as displayMap.Input['map_type'],
		latitude_key: map.latitudeKey,
		longitude_key: map.longitudeKey,
		label_key: map.labelKey,
		tooltip_keys: map.tooltipKeys,
		marker_color: map.markerColor,
		marker_radius: map.markerRadius,
		title: map.title,
	};
}
