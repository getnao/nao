import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import type { StoryBlockChartConfig } from '@nao/shared/story-app';
import type { StoryBlockEditTarget, StoryTableFormatEditTarget } from '@/stores/story-block-edit';

import { ChartConfigEditDialog, ChartConfigEditForm } from '@/components/tool-calls/display-chart-edit-dialog';
import { TableFormatEditDialog, TableFormatEditForm } from '@/components/tool-calls/display-table-edit-dialog';
import {
	diffKitBlock,
	fromDialogConfig,
	tableFormatChange,
	toDialogConfig,
	toHexColors,
} from '@/lib/story-kit-block-edit';
import { trpc } from '@/main';
import { KIT_CHART_TYPES } from '@/story-runtime/story-kit/block-config';

export const BLOCK_EDIT_DESCRIPTION = 'Changes are saved to the story as a new version.';
export const TABLE_FORMAT_EDIT_DESCRIPTION = `Apply conditional formatting to columns. ${BLOCK_EDIT_DESCRIPTION}`;

interface CustomStoryBlockEditFormProps {
	target: StoryBlockEditTarget;
	onCancel: () => void;
	onSaved: () => void;
}

export function CustomStoryBlockEditForm({ target, onCancel, onSaved }: CustomStoryBlockEditFormProps) {
	const edit = useChartConfigEdit(target);
	if (!edit) {
		return null;
	}
	return <ChartConfigEditForm {...edit} onCancel={onCancel} onSaved={onSaved} />;
}

interface CustomStoryBlockEditDialogProps {
	target: StoryBlockEditTarget | null;
	onClose: () => void;
}

export function CustomStoryBlockEditDialog({ target, onClose }: CustomStoryBlockEditDialogProps) {
	const edit = useChartConfigEdit(target);
	if (!edit) {
		return null;
	}
	return (
		<ChartConfigEditDialog
			{...edit}
			open
			onOpenChange={closeOnDismiss(onClose)}
			description={BLOCK_EDIT_DESCRIPTION}
		/>
	);
}

interface CustomStoryTableFormatFormProps {
	target: StoryTableFormatEditTarget;
	onCancel: () => void;
	onSaved: () => void;
}

export function CustomStoryTableFormatForm({ target, onCancel, onSaved }: CustomStoryTableFormatFormProps) {
	const edit = useTableFormatEdit(target);
	if (!edit) {
		return null;
	}
	return <TableFormatEditForm {...edit} onCancel={onCancel} onSaved={onSaved} />;
}

interface CustomStoryTableFormatDialogProps {
	target: StoryTableFormatEditTarget | null;
	onClose: () => void;
}

export function CustomStoryTableFormatDialog({ target, onClose }: CustomStoryTableFormatDialogProps) {
	const edit = useTableFormatEdit(target);
	if (!edit) {
		return null;
	}
	return (
		<TableFormatEditDialog
			{...edit}
			open
			onOpenChange={closeOnDismiss(onClose)}
			description={TABLE_FORMAT_EDIT_DESCRIPTION}
		/>
	);
}

function closeOnDismiss(onClose: () => void) {
	return (open: boolean) => {
		if (!open) {
			onClose();
		}
	};
}

function useChartConfigEdit(target: StoryBlockEditTarget | null) {
	const saveMutation = useSaveBlockEditMutation();
	const colors = useMemo(() => target && toHexColors(target.payload.colors), [target]);
	const config = useMemo(() => target && colors && toDialogConfig(target.payload.config, colors), [target, colors]);

	if (!target || !colors || !config) {
		return null;
	}

	const { chatId, storySlug, versionNumber, payload } = target;
	const save = async (next: StoryBlockChartConfig) => {
		const change = diffKitBlock(payload.block, payload.config, fromDialogConfig(payload.config, colors, next));
		if (change) {
			await saveMutation.mutateAsync({ chatId, storySlug, versionNumber, block: payload.block, change });
		}
	};

	return {
		config,
		availableColumns: payload.columns,
		data: payload.rows,
		chartTypes: KIT_CHART_TYPES,
		palette: colors.palette,
		enforceExportSafeFormats: false,
		isSaving: saveMutation.isPending,
		onSave: save,
	};
}

function useTableFormatEdit(target: StoryTableFormatEditTarget | null) {
	const saveMutation = useSaveBlockEditMutation();
	if (!target) {
		return null;
	}
	const { chatId, storySlug, versionNumber, request } = target;
	const save = async (next: ColumnConditionalFormats) => {
		const change = tableFormatChange(request.formats, next);
		if (change) {
			await saveMutation.mutateAsync({ chatId, storySlug, versionNumber, block: request.block, change });
		}
	};
	return {
		columns: request.columns,
		data: request.rows,
		formats: request.formats,
		onSave: save,
		isSaving: saveMutation.isPending,
	};
}

function useSaveBlockEditMutation() {
	const queryClient = useQueryClient();
	return useMutation(
		trpc.story.editCustomStoryBlock.mutationOptions({
			onSuccess: async (_result, { chatId, storySlug }) => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }),
					}),
					queryClient.invalidateQueries({
						queryKey: trpc.story.getCustomVersion.queryKey({ chatId, storySlug }),
					}),
					queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() }),
				]);
			},
		}),
	);
}
