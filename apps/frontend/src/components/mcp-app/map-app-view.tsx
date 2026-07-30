import { memo } from 'react';
import { McpAppHeader } from './mcp-app-header';
import { OpenInNaoButton } from './open-in-nao-button';
import type { McpMapEmbedStoredConfig } from '@nao/shared';
import type { ParsedMapBlock } from '@nao/shared/story-segments';

import { StoryMapRender } from '@/components/story-map-embed';

interface MapAppViewProps {
	config: McpMapEmbedStoredConfig;
	data: Record<string, unknown>[];
	columns: string[];
	naoUrl?: string;
}

function configToParsedMapBlock(config: McpMapEmbedStoredConfig): ParsedMapBlock {
	return {
		queryId: config.query_id,
		mapType: config.map_type as ParsedMapBlock['mapType'],
		latitudeKey: config.latitude_key,
		longitudeKey: config.longitude_key,
		labelKey: config.label_key,
		tooltipKeys: config.tooltip_keys,
		color: config.color,
		radius: config.radius,
		sizeKey: config.size_key,
		valueKey: config.value_key,
		regionKey: config.region_key,
		regionBoundaries: config.region_boundaries,
		boundariesUrl: config.boundaries_url,
		boundariesJoinProperty: config.boundaries_join_property,
		geometryKey: config.geometry_key,
		title: config.title,
	};
}

export const MapAppView = memo(function MapAppView({ config, data, naoUrl }: MapAppViewProps) {
	const mapBlock = configToParsedMapBlock(config);

	return (
		<div className='flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background text-foreground'>
			<McpAppHeader title={config.title}>{naoUrl ? <OpenInNaoButton url={naoUrl} /> : null}</McpAppHeader>
			<div className='min-h-0 flex-1 overflow-auto'>
				<div className='mx-auto flex w-full min-w-0 max-w-5xl flex-col p-4 md:p-8'>
					<StoryMapRender map={mapBlock} data={data} />
				</div>
			</div>
		</div>
	);
});
