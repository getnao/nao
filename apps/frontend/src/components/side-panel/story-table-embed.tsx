import { memo, useMemo } from 'react';
import type { ParsedTableBlock } from '@/lib/story-segments';
import { useAgentContext } from '@/contexts/agent.provider';
import { TableDisplay } from '@/components/tool-calls/display-table';

export const StoryTableEmbed = memo(function StoryTableEmbed({ table }: { table: ParsedTableBlock }) {
	const { messages } = useAgentContext();

	const sourceData = useMemo(() => {
		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type === 'tool-execute_sql' && part.output?.id === table.queryId) {
					return part.output;
				}
			}
		}
		return null;
	}, [messages, table.queryId]);

	if (!sourceData?.data || !Array.isArray(sourceData.data)) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Table data unavailable (query: {table.queryId})
			</div>
		);
	}

	return (
		<TableDisplay
			data={sourceData.data as Record<string, unknown>[]}
			columns={sourceData.columns}
			title={table.title}
			tableContainerClassName='max-h-[28rem]'
		/>
	);
});
