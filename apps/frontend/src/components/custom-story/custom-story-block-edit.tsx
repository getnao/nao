import { ChartStyleContext } from '@nao/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ColumnConditionalFormats } from '@nao/shared/conditional-formatting';
import type { StoryBlockChartConfig, StoryBlockEditPayload, StoryTableFormatEditRequest } from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';

import { ChartConfigEditDialog } from '@/components/tool-calls/display-chart-edit-dialog';
import { TableFormatEditDialog } from '@/components/tool-calls/display-table-edit-dialog';
import {
	diffKitBlock,
	fromDialogConfig,
	tableFormatChange,
	toDialogConfig,
	toHexColors,
} from '@/lib/story-kit-block-edit';
import { trpc } from '@/main';

const BLOCK_EDIT_DESCRIPTION = 'Changes are saved to the story as a new version.';
const TABLE_FORMAT_EDIT_DESCRIPTION = `Apply conditional formatting to columns. ${BLOCK_EDIT_DESCRIPTION}`;

interface StoryEditTargetBase {
	chatId: string;
	storySlug: string;
	versionNumber: number;
}

export interface StoryBlockEditTarget extends StoryEditTargetBase {
	payload: StoryBlockEditPayload;
}

export interface StoryTableFormatEditTarget extends StoryEditTargetBase {
	request: StoryTableFormatEditRequest;
}

interface CustomStoryBlockEditDialogProps {
	target: StoryBlockEditTarget | null;
	theme: StoryTheme;
	onClose: () => void;
}

export function CustomStoryBlockEditDialog({ target, theme, onClose }: CustomStoryBlockEditDialogProps) {
	const edit = useChartConfigEdit(target);
	const chartStyle = useMemo(() => ({ barRadius: theme.charts.barRadius }), [theme]);
	if (!edit) {
		return null;
	}
	return (
		<ChartStyleContext.Provider value={chartStyle}>
			<ChartConfigEditDialog
				{...edit}
				open
				onOpenChange={closeOnDismiss(onClose)}
				description={BLOCK_EDIT_DESCRIPTION}
			/>
		</ChartStyleContext.Provider>
	);
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
