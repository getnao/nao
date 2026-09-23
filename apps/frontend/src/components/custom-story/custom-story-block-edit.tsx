import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { StoryBlockChartConfig } from '@nao/shared/story-app';
import type { StoryBlockEditTarget } from '@/stores/story-block-edit';

import { ChartConfigEditDialog, ChartConfigEditForm } from '@/components/tool-calls/display-chart-edit-dialog';
import { diffKitBlock, fromDialogConfig, toDialogConfig, toHexColors } from '@/lib/story-kit-block-edit';
import { trpc } from '@/main';
import { KIT_CHART_TYPES } from '@/story-runtime/story-kit/block-config';

export const BLOCK_EDIT_DESCRIPTION = 'Changes are saved to the story as a new version.';

interface CustomStoryBlockEditFormProps {
	target: StoryBlockEditTarget;
	onCancel: () => void;
	onSaved: () => void;
}

export function CustomStoryBlockEditForm({ target, onCancel, onSaved }: CustomStoryBlockEditFormProps) {
	const edit = useBlockEdit(target);
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
	const edit = useBlockEdit(target);
	if (!edit) {
		return null;
	}
	return (
		<ChartConfigEditDialog
			{...edit}
			open
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
			description={BLOCK_EDIT_DESCRIPTION}
		/>
	);
}

function useBlockEdit(target: StoryBlockEditTarget | null) {
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
