import { Download, FileCode, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';

import type { DownloadFormat } from '@nao/shared/types';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { trpcClient } from '@/main';

interface StoryDownloadOptions {
	chatId: string;
	storySlug: string;
	shareId?: string;
	isOwner?: boolean;
	versionNumber?: number;
}

function useStoryDownload({ chatId, storySlug, shareId, isOwner = true, versionNumber }: StoryDownloadOptions) {
	const [isDownloading, setIsDownloading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const canDownload = isOwner || !!shareId;

	const handleDownload = async (format: DownloadFormat) => {
		if (!canDownload) {
			return;
		}
		setIsDownloading(true);
		setError(null);
		try {
			const result = isOwner
				? await trpcClient.story.download.query({ chatId, storySlug, format, versionNumber })
				: await trpcClient.storyShare.download.query({ shareId: shareId!, format, versionNumber });
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
}

export function StoryDownload({ isAgentRunning, ...downloadOptions }: StoryDownloadProps) {
	const { isDownloading, error, canDownload, handleDownload } = useStoryDownload(downloadOptions);

	if (!canDownload) {
		return null;
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant='outline'
						size='sm'
						disabled={isAgentRunning || isDownloading}
						title='Download story'
					>
						{isDownloading ? (
							<Loader2 className='size-3.5 animate-spin' />
						) : (
							<Download className='size-3.5' />
						)}
						<span>Download</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end'>
					<DropdownMenuLabel className='text-xs text-muted-foreground'>Download as</DropdownMenuLabel>
					<DropdownMenuGroup>
						<DropdownMenuItem onSelect={() => handleDownload('pdf')}>
							<FileText /> <span className='text-xs'>PDF</span>
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => handleDownload('html')}>
							<FileCode /> <span className='text-xs'>HTML</span>
						</DropdownMenuItem>
					</DropdownMenuGroup>
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

interface StoryDownloadSubMenuProps extends StoryDownloadOptions {
	isAgentRunning?: boolean;
}

export function StoryDownloadSubMenu({ isAgentRunning, ...downloadOptions }: StoryDownloadSubMenuProps) {
	const { isDownloading, canDownload, handleDownload } = useStoryDownload(downloadOptions);

	if (!canDownload) {
		return null;
	}

	return (
		<>
			<DropdownMenuLabel className='text-xs text-muted-foreground'>Download as</DropdownMenuLabel>
			<DropdownMenuItem onSelect={() => handleDownload('pdf')} disabled={isDownloading || isAgentRunning}>
				<FileText className='size-3' />
				PDF
			</DropdownMenuItem>
			<DropdownMenuItem onSelect={() => handleDownload('html')} disabled={isDownloading || isAgentRunning}>
				<FileCode className='size-3' /> HTML
			</DropdownMenuItem>
		</>
	);
}
