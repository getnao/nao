import { memo, useMemo } from 'react';
import type { UIMessage } from '@nao/backend/chat';
import type { ParsedTableBlock } from '@nao/shared/story-segments';

import { DataTableCard } from '@/components/data-table-card';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useStoryEmbedData } from '@/contexts/story-embed-data';

export const StoryTableEmbed = memo(function StoryTableEmbed({ table }: { table: ParsedTableBlock }) {
	const agent = useOptionalAgentContext();
	const embedData = useStoryEmbedData();

	const sourceData = useMemo(() => {
		const fromEmbedData = embedData?.[table.queryId];
		if (fromEmbedData) {
			return fromEmbedData;
		}

		const findInMessages = (messages: UIMessage[]) => {
			for (const message of messages) {
				for (const part of message.parts) {
					if (part.type === 'tool-execute_sql' && part.output?.id === table.queryId) {
						return part.output;
					}
				}
			}
			return null;
		};

		return findInMessages(agent?.messages ?? []);
	}, [embedData, agent?.messages, table.queryId]);

	if (!sourceData?.data || !Array.isArray(sourceData.data)) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Table data unavailable (query: {table.queryId})
			</div>
		);
	}

	return (
		<DataTableCard
			data={sourceData.data as Record<string, unknown>[]}
			columns={sourceData.columns ?? []}
			title={table.title}
		/>
	);
});
