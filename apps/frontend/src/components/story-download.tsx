import { Download, FileCode, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { DownloadFormat, ShareSource } from '@nao/shared/types';
import {
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { trpcClient } from '@/main';

export interface StoryDownloadFile {
	data: string;
	filename: string;
	mimeType: string;
}

export interface StoryDownloadOptions {
	storyId?: string;
	chatId?: string;
	storySlug?: string;
	shareSource?: ShareSource;
	isOwner?: boolean;
	versionNumber?: number;
	/** Replaces the server-rendered export, e.g. a custom story downloads a snapshot of its rendered frame. */
	onDownload?: (format: DownloadFormat) => Promise<StoryDownloadFile>;
}

export function canDownloadStory({ storyId, shareSource, isOwner = true, onDownload }: StoryDownloadOptions) {
	return isOwner || !!shareSource || !!storyId || !!onDownload;
}

function useStoryDownload({
	storyId,
	chatId,
	storySlug,
	shareSource,
	isOwner = true,
	versionNumber,
	onDownload,
}: StoryDownloadOptions) {
	const [isDownloading, setIsDownloading] = useState(false);
	const canDownload = canDownloadStory({ storyId, shareSource, isOwner, onDownload });

	const handleDownload = async (format: DownloadFormat) => {
		if (!canDownload) {
			return;
		}
		setIsDownloading(true);
		try {
			let result;
			if (onDownload) {
				result = await onDownload(format);
			} else if (storyId) {
				result = await trpcClient.story.downloadStandalone.query({ storyId, format });
			} else if (isOwner) {
				result = await trpcClient.story.download.query({
					chatId: chatId!,
					storySlug: storySlug!,
					format,
					versionNumber,
				});
			} else if (shareSource?.type === 'chat') {
				result = await trpcClient.sharedChat.downloadStory.query({
					shareId: shareSource.shareId,
					storySlug: storySlug!,
					format,
					versionNumber,
				});
			} else {
				result = await trpcClient.storyShare.download.query({
					storyId: shareSource!.storyId,
					format,
					versionNumber,
				});
			}
			const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
			const blob = new Blob([bytes], { type: result.mimeType });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = result.filename;
			a.click();
			URL.revokeObjectURL(url);
		} catch (err) {
			console.error('Story download failed:', err);
		} finally {
			setIsDownloading(false);
		}
	};

	return { isDownloading, canDownload, handleDownload };
}

interface StoryDownloadMenuProps extends StoryDownloadOptions {
	isAgentRunning?: boolean;
	isSaving?: boolean;
}

export function StoryDownloadMenu({ isAgentRunning, isSaving, ...downloadOptions }: StoryDownloadMenuProps) {
	const { isDownloading, canDownload, handleDownload } = useStoryDownload(downloadOptions);

	if (!canDownload) {
		return null;
	}

	const isDisabled = isAgentRunning || isDownloading || isSaving;

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger disabled={isDisabled}>
				{isDownloading ? (
					<Loader2 className='size-3.5 animate-spin' strokeWidth={2.25} />
				) : (
					<Download className='size-3.5' strokeWidth={2.25} />
				)}
				<span>Download</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				<DropdownMenuItem onSelect={() => handleDownload('pdf')}>
					<FileText /> <span>PDF</span>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={() => handleDownload('html')}>
					<FileCode /> <span>HTML</span>
				</DropdownMenuItem>
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
