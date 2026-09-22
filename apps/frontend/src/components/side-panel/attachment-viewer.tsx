import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Loader2 } from 'lucide-react';
import { Streamdown } from 'streamdown';
import type { AttachmentPreview, AttachmentSheet } from '@/lib/attachment-preview';
import { AttachmentFileIcon } from '@/components/attachment-file-icon';
import { MarkdownTable } from '@/components/chat-messages/markdown-table';
import { SidePanelHeader } from '@/components/side-panel/side-panel-header';
import { TextFilePreview } from '@/components/text-file-preview';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { TabBar } from '@/components/ui/tab-bar';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useAttachmentDownload } from '@/hooks/use-attachment-download';
import { loadAttachmentPreview, MAX_PREVIEW_ROWS, MAX_TABULAR_PREVIEW_SIZE_MB } from '@/lib/attachment-preview';
import { markdownPlugins } from '@/lib/markdown';

const markdownComponents = { table: ({ node, className }: any) => <MarkdownTable node={node} className={className} /> };

interface AttachmentViewerProps {
	/** Virtual path of the file in permanent storage. */
	path: string;
	fileName: string;
}

/** A file in permanent storage, shown as its own side panel. */
export function AttachmentViewer({ path, fileName }: AttachmentViewerProps) {
	const preview = useQuery({
		queryKey: ['attachment-preview', path],
		queryFn: () => loadAttachmentPreview(path),
		staleTime: Infinity,
		retry: false,
	});
	const download = useAttachmentDownload(path);

	return (
		<div className='flex h-full min-h-0 flex-col bg-background'>
			<SidePanelHeader
				title={fileName}
				label={path}
				actions={
					<SimpleTooltip content='Download'>
						<Button
							variant='ghost-muted'
							size='icon-sm'
							className='hover:rounded-full'
							aria-label='Download'
							disabled={download.isPending}
							onClick={() => download.mutate()}
						>
							{download.isPending ? <Loader2 className='animate-spin' /> : <Download />}
						</Button>
					</SimpleTooltip>
				}
			/>

			{download.error && <ErrorBanner message={download.error.message} />}

			{preview.isPending ? (
				<div className='flex flex-1 items-center justify-center'>
					<Spinner />
				</div>
			) : preview.error ? (
				<Notice fileName={fileName} message={preview.error.message} />
			) : (
				<PreviewBody preview={preview.data} fileName={fileName} />
			)}
		</div>
	);
}

function PreviewBody({ preview, fileName }: { preview: AttachmentPreview; fileName: string }) {
	switch (preview.kind) {
		case 'table':
			return <SheetsPreview sheets={preview.sheets} />;
		case 'markdown':
			return <MarkdownPreview content={preview.content} />;
		case 'text':
			return (
				<div className='min-h-0 flex-1'>
					<TextFilePreview filePath={fileName} content={preview.content} />
				</div>
			);
		case 'pdf':
			return <PdfPreview blob={preview.blob} fileName={fileName} />;
		case 'too-large':
			return (
				<Notice
					fileName={fileName}
					message={`Files over ${MAX_TABULAR_PREVIEW_SIZE_MB} MB are not parsed in the browser. Download it to open it.`}
				/>
			);
		case 'unsupported':
			return (
				<Notice fileName={fileName} message='nao cannot preview this kind of file. Download it to open it.' />
			);
	}
}

function SheetsPreview({ sheets }: { sheets: AttachmentSheet[] }) {
	const [activeName, setActiveName] = useState(sheets[0]?.name ?? '');
	const sheet = sheets.find((candidate) => candidate.name === activeName) ?? sheets[0];

	if (!sheet) {
		return <Notice message='This file holds no sheet to show.' />;
	}

	return (
		<div className='flex min-h-0 flex-1 flex-col'>
			{sheets.length > 1 && (
				<TabBar
					tabs={sheets.map(({ name }) => ({ id: name, label: name }))}
					activeTab={sheet.name}
					onTabChange={setActiveName}
					idBase='attachment-sheet'
					className='min-w-0 shrink-0 overflow-x-auto border-b px-2'
				/>
			)}
			{sheet.truncated && (
				<div className='shrink-0 border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground'>
					Showing the first {MAX_PREVIEW_ROWS.toLocaleString()} rows. Download the file to see the rest.
				</div>
			)}
			<TableDisplay
				data={sheet.rows}
				columns={sheet.columns}
				className='min-h-0 flex-1'
				tableContainerClassName='flex-1 rounded-none border-0'
				emptyLabel='This sheet is empty'
				compactFooter
			/>
		</div>
	);
}

function MarkdownPreview({ content }: { content: string }) {
	return (
		<div className='min-h-0 flex-1 overflow-auto px-8 py-6'>
			<Streamdown mode='static' plugins={markdownPlugins} components={markdownComponents}>
				{content}
			</Streamdown>
		</div>
	);
}

function PdfPreview({ blob, fileName }: { blob: Blob; fileName: string }) {
	const [url, setUrl] = useState<string | null>(null);

	useEffect(() => {
		const objectUrl = URL.createObjectURL(blob);
		setUrl(objectUrl);
		return () => URL.revokeObjectURL(objectUrl);
	}, [blob]);

	if (!url) {
		return null;
	}

	return <iframe src={url} title={fileName} className='min-h-0 flex-1 border-0' />;
}

function Notice({ message, fileName }: { message: string; fileName?: string }) {
	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center'>
			{fileName && <AttachmentFileIcon fileName={fileName} className='size-8 opacity-40' />}
			<p className='text-sm text-muted-foreground'>{message}</p>
		</div>
	);
}

function ErrorBanner({ message }: { message: string }) {
	return <div className='shrink-0 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive'>{message}</div>;
}
