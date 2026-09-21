import { sanitizeConditionalFormats } from '@nao/shared/conditional-formatting';
import { Pencil } from 'lucide-react';
import { memo, useState } from 'react';
import { StoryEmbedFallback } from './story-embed-fallback';
import type { ParsedTableBlock } from '@nao/shared/story-segments';

import { DataTableCard } from '@/components/data-table-card';
import { TableFormatEditDialog } from '@/components/tool-calls/display-table-edit-dialog';
import { Button } from '@/components/ui/button';
import { useStoryEmbedData } from '@/contexts/story-embed-data';
import { useStoryTableEdit } from '@/contexts/story-table-edit';
import { useSourceQuery } from '@/hooks/use-source-query';

export const StoryTableEmbed = memo(function StoryTableEmbed({
	table,
	dragHandle,
	dragHandlePlacement = 'trailing',
}: {
	table: ParsedTableBlock;
	dragHandle?: React.ReactNode;
	dragHandlePlacement?: 'leading' | 'trailing';
}) {
	const embedData = useStoryEmbedData();
	const embedSourceData = embedData?.[table.queryId];
	const { sourceData: agentSourceData } = useSourceQuery(embedSourceData ? undefined : table.queryId);
	const sourceData = embedSourceData ?? agentSourceData;

	if (!sourceData?.data || !Array.isArray(sourceData.data)) {
		return (
			<StoryEmbedFallback dragHandle={dragHandle} dragHandlePlacement={dragHandlePlacement}>
				Table data unavailable (query: {table.queryId})
			</StoryEmbedFallback>
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
			leadingHeader={dragHandlePlacement === 'leading' ? dragHandle : undefined}
			headerActions={
				<>
					{dragHandlePlacement === 'leading' ? null : dragHandle}
					<StoryTableEditControls table={table} data={rows} columns={columns} />
				</>
			}
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
