import { Download, FileCode, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { DownloadFormat } from '@nao/shared/types';
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { trpcClient } from '@/main';

interface StoryDownloadOptions {
	storyId?: string;
	chatId?: string;
	storySlug?: string;
	shareId?: string;
	shareType?: 'chat' | 'story';
	isOwner?: boolean;
	versionNumber?: number;
}

function useStoryDownload({
	storyId,
	chatId,
	storySlug,
	shareId,
	shareType = 'story',
	isOwner = true,
	versionNumber,
}: StoryDownloadOptions) {
	const [isDownloading, setIsDownloading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const canDownload = isOwner || !!shareId || !!storyId;

	const handleDownload = async (format: DownloadFormat) => {
		if (!canDownload) {
			return;
		}
		setIsDownloading(true);
		setError(null);
		try {
			let result;
			if (storyId) {
				result = await trpcClient.story.downloadStandalone.query({ storyId, format });
			} else if (isOwner) {
				result = await trpcClient.story.download.query({
					chatId: chatId!,
					storySlug: storySlug!,
					format,
					versionNumber,
				});
			} else if (shareType === 'chat') {
				result = await trpcClient.sharedChat.downloadStory.query({
					shareId: shareId!,
					storySlug: storySlug!,
					format,
					versionNumber,
				});
			} else {
				result = await trpcClient.storyShare.download.query({ shareId: shareId!, format, versionNumber });
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
			const message = err instanceof Error ? err.message : 'Download failed';
			setError(message);
			console.error('Story download failed:', err);
		} finally {
			setIsDownloading(false);
		}
	};

	return { isDownloading, error, canDownload, handleDownload };
}

interface StoryDownloadMenuItemProps extends StoryDownloadOptions {
	isAgentRunning?: boolean;
	isSaving?: boolean;
}

/**
 * Download entry for use inside an existing dropdown, with the formats in a submenu. Selecting a
 * format keeps the menu open so the spinner and any error stay visible, since PDF rendering runs
 * server-side and is not instant.
 */
export function StoryDownloadMenuItem({ isAgentRunning, isSaving, ...downloadOptions }: StoryDownloadMenuItemProps) {
	const { isDownloading, error, canDownload, handleDownload } = useStoryDownload(downloadOptions);

	if (!canDownload) {
		return null;
	}

	const startDownload = (format: DownloadFormat) => (event: Event) => {
		event.preventDefault();
		void handleDownload(format);
	};

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger disabled={isAgentRunning || isSaving}>
				{isDownloading ? (
					<Loader2 className='size-3.5 animate-spin' strokeWidth={2.25} />
				) : (
					<Download className='size-3.5' strokeWidth={2.25} />
				)}
				<span>Download</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuSubContent className='w-auto min-w-20'>
				<DropdownMenuItem disabled={isDownloading} onSelect={startDownload('pdf')}>
					<FileText /> <span>PDF</span>
				</DropdownMenuItem>
				<DropdownMenuItem disabled={isDownloading} onSelect={startDownload('html')}>
					<FileCode /> <span>HTML</span>
				</DropdownMenuItem>
				{error && (
					<>
						<DropdownMenuSeparator />
						<p
							role='alert'
							className='line-clamp-3 max-w-56 px-2 py-1 text-xs leading-snug text-destructive'
							title={error}
						>
							{error}
						</p>
					</>
				)}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}
