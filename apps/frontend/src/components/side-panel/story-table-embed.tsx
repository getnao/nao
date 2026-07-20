import { sanitizeConditionalFormats } from '@nao/shared/conditional-formatting';
import { Pencil } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { UIMessage } from '@nao/backend/chat';
import type { ParsedTableBlock } from '@nao/shared/story-segments';

import { DataTableCard } from '@/components/data-table-card';
import { TableFormatEditDialog } from '@/components/tool-calls/display-table-edit-dialog';
import { Button } from '@/components/ui/button';
import { useOptionalAgentContext } from '@/contexts/agent.provider';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { useStoryTableEdit } from '@/contexts/story-table-edit';

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

	const rows = sourceData.data as Record<string, unknown>[];
	const columns = sourceData.columns ?? [];

	return (
		<DataTableCard
			data={rows}
			columns={columns}
			title={table.title}
			conditionalFormats={table.conditionalFormats}
			headerActions={<StoryTableEditControls table={table} data={rows} columns={columns} />}
		/>
	);
});

/**
 * Renders an Edit (pencil) button + formatting dialog for a story-embedded table
 * when the surrounding story provides a `saveTable` handler and the block carries
 * its original `rawTag`. Persists edits back into the story's `<table>` block.
 */
export function StoryTableEditControls({
	table,
	data,
	columns,
}: {
	table: ParsedTableBlock;
	data: Record<string, unknown>[];
	columns: string[];
}) {
	const edit = useStoryTableEdit();
	const [isEditOpen, setIsEditOpen] = useState(false);

	const rawTag = table.rawTag;
	if (!edit || !rawTag) {
		return null;
	}

	const formats = sanitizeConditionalFormats(table.conditionalFormats) ?? {};

	return (
		<>
			<Button
				variant='ghost-muted'
				size='icon-xs'
				className='hover:rounded-full hover:bg-accent/70'
				onClick={() => setIsEditOpen(true)}
				title='Edit formatting'
			>
				<Pencil className='size-3 text-muted-foreground/70' />
			</Button>
			<TableFormatEditDialog
				open={isEditOpen}
				onOpenChange={setIsEditOpen}
				columns={columns}
				data={data}
				formats={formats}
				onSave={(next) =>
					edit.saveTable(rawTag, {
						query_id: table.queryId,
						title: table.title || undefined,
						conditional_formats: next,
					})
				}
				isSaving={edit.isSaving}
				description='Apply conditional formatting to columns. Changes are saved to the story as a new version.'
			/>
		</>
	);
}
