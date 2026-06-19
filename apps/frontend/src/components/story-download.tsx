import { Download, FileCode, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { DownloadFormat } from '@nao/shared/types';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { trpcClient } from '@/main';

interface StoryDownloadOptions {
	storyId?: string;
	chatId?: string;
	storySlug?: string;
	shareId?: string;
	isOwner?: boolean;
	versionNumber?: number;
}

function useStoryDownload({
	storyId,
	chatId,
	storySlug,
	shareId,
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

interface StoryDownloadProps extends StoryDownloadOptions {
	isAgentRunning?: boolean;
	iconOnly?: boolean;
}

export function StoryDownload({ isAgentRunning, iconOnly = false, ...downloadOptions }: StoryDownloadProps) {
	const { isDownloading, error, canDownload, handleDownload } = useStoryDownload(downloadOptions);

	if (!canDownload) {
		return null;
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					{iconOnly ? (
						<Button
							variant='ghost'
							size='icon-sm'
							className='hover:rounded-full'
							disabled={isAgentRunning || isDownloading}
							aria-label='Download story'
							title='Download story'
						>
							{isDownloading ? (
								<Loader2 className='size-3.5 animate-spin' strokeWidth={2.25} />
							) : (
								<Download className='size-3.5' strokeWidth={2.25} />
							)}
						</Button>
					) : (
						<Button
							variant='outline'
							size='sm'
							disabled={isAgentRunning || isDownloading}
							aria-label='Download story'
							title='Download story'
						>
							{isDownloading ? (
								<Loader2 className='size-3.5 animate-spin' />
							) : (
								<Download className='size-3.5' />
							)}
							<span>Download</span>
						</Button>
					)}
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-auto min-w-20'>
					<DropdownMenuItem onSelect={() => handleDownload('pdf')}>
						<FileText /> <span>PDF</span>
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => handleDownload('html')}>
						<FileCode /> <span>HTML</span>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{error && (
				<p className='text-xs text-destructive mt-1 max-w-48 truncate' title={error}>
					{error}
				</p>
			)}
		</>
	);
}
