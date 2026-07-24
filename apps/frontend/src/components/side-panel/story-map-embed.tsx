import { Pencil } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { StoryEmbedFallback } from './story-embed-fallback';
import type { ParsedMapBlock } from '@nao/shared/story-segments';
import type { displayMap } from '@nao/shared/tools';

import { StoryMapRender } from '@/components/story-map-embed';
import { MapConfigEditDialog } from '@/components/tool-calls/display-map-edit-dialog';
import { Button } from '@/components/ui/button';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { useStoryMapEdit } from '@/contexts/story-map-edit';
import { findLatestExecuteSqlInMessages } from '@/lib/execute-sql-messages';

export const StoryMapEmbed = memo(function StoryMapEmbed({
	map,
	dragHandle,
}: {
	map: ParsedMapBlock;
	dragHandle?: React.ReactNode;
}) {
	const agent = useOptionalAgentContext();
	const embedData = useStoryEmbedData();
	const edit = useStoryMapEdit();
	const [isEditOpen, setIsEditOpen] = useState(false);

	const sourceData = useMemo(() => {
		const fromEmbedData = embedData?.[map.queryId];
		if (fromEmbedData) {
			return fromEmbedData;
		}

		return findLatestExecuteSqlInMessages(agent?.messages ?? [], map.queryId)?.output ?? null;
	}, [embedData, agent?.messages, map.queryId]);

	const config = useMemo(() => mapBlockToConfig(map), [map]);
	const canEdit = Boolean(edit && map.rawTag);

	if (!sourceData?.data || sourceData.data.length === 0) {
		return (
			<StoryEmbedFallback dragHandle={dragHandle}>Map data unavailable (query: {map.queryId})</StoryEmbedFallback>
		);
	}

	return (
		<div className='my-2 flex flex-col gap-2'>
			<div className='flex items-center justify-between gap-2'>
				{map.title ? (
					<span className='text-sm font-medium text-foreground flex-1 min-w-0 truncate'>{map.title}</span>
				) : (
					<div className='flex-1' />
				)}
				<div className='flex shrink-0 items-center gap-1'>
					{dragHandle}
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
			<StoryMapRender map={map} data={sourceData.data} />
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
	);
});

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
