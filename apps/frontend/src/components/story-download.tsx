import { Copy, Download, FileCode, FileDown, FileText, Loader2 } from 'lucide-react';
import { marked, Renderer } from 'marked';
import { useState } from 'react';

import type { DownloadFormat, ShareSource, StoryDownloadFormat } from '@nao/shared/types';
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

function useStoryDownload(options: StoryDownloadOptions) {
	const [isDownloading, setIsDownloading] = useState(false);
	const canDownload = canDownloadStory(options);

	const runExport = async (label: string, exportStory: () => Promise<void>) => {
		if (!canDownload) {
			return;
		}
		setIsDownloading(true);
		try {
			await exportStory();
		} catch (err) {
			console.error(`Story ${label} failed:`, err);
		} finally {
			setIsDownloading(false);
		}
	};

	const handleDownload = (format: StoryDownloadFormat) =>
		runExport('download', async () => saveFile(await fetchStoryFile(options, format)));

	const handleCopyMarkdown = () =>
		runExport('copy', () =>
			copyMarkdown(fetchStoryFile(options, 'markdown').then((file) => decodeText(file.data))),
		);

	return { isDownloading, canDownload, handleDownload, handleCopyMarkdown };
}

interface StoryDownloadMenuProps extends StoryDownloadOptions {
	isAgentRunning?: boolean;
	isSaving?: boolean;
}

export function StoryDownloadMenu({ isAgentRunning, isSaving, ...downloadOptions }: StoryDownloadMenuProps) {
	const { isDownloading, canDownload, handleDownload, handleCopyMarkdown } = useStoryDownload(downloadOptions);

	if (!canDownload) {
		return null;
	}

	const isDisabled = isAgentRunning || isDownloading || isSaving;
	const supportsMarkdown = !downloadOptions.onDownload;

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
				{supportsMarkdown && (
					<>
						<DropdownMenuItem onSelect={() => handleDownload('markdown')}>
							<FileDown /> <span>Markdown</span>
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={handleCopyMarkdown}>
							<Copy /> <span>Copy as Markdown</span>
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	);
}

async function fetchStoryFile(
	{ storyId, chatId, storySlug, shareSource, isOwner = true, versionNumber, onDownload }: StoryDownloadOptions,
	format: StoryDownloadFormat,
): Promise<StoryDownloadFile> {
	if (onDownload) {
		if (format === 'markdown') {
			throw new Error('Custom stories cannot be exported as Markdown.');
		}
		return onDownload(format);
	}
	if (storyId) {
		return trpcClient.story.downloadStandalone.query({ storyId, format, versionNumber });
	}
	if (isOwner) {
		return trpcClient.story.download.query({ chatId: chatId!, storySlug: storySlug!, format, versionNumber });
	}
	if (shareSource?.type === 'chat') {
		return trpcClient.sharedChat.downloadStory.query({
			shareId: shareSource.shareId,
			storySlug: storySlug!,
			format,
			versionNumber,
		});
	}
	return trpcClient.storyShare.download.query({ storyId: shareSource!.storyId, format, versionNumber });
}

function saveFile(file: StoryDownloadFile) {
	const url = URL.createObjectURL(new Blob([decodeBase64(file.data)], { type: file.mimeType }));
	const link = document.createElement('a');
	link.href = url;
	link.download = file.filename;
	link.click();
	URL.revokeObjectURL(url);
}

/** The clipboard item is created before the export resolves, so browsers still see the copy as part of the click. */
async function copyMarkdown(markdown: Promise<string>) {
	await navigator.clipboard.write([
		new ClipboardItem({
			'text/plain': markdown.then((text) => new Blob([text], { type: 'text/plain' })),
			'text/html': markdown.then((text) => new Blob([markdownToHtml(text)], { type: 'text/html' })),
		}),
	]);
}

const htmlFreeRenderer = new Renderer();
htmlFreeRenderer.html = () => '';

/** Rich editors like Notion and Google Docs paste the HTML flavour, plain-text editors the Markdown one. */
function markdownToHtml(markdown: string): string {
	return marked.parse(markdown, { async: false, renderer: htmlFreeRenderer });
}

function decodeText(base64: string): string {
	return new TextDecoder().decode(decodeBase64(base64));
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
	return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
