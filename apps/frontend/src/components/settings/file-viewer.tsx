import { File } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { TextFilePreview } from '@/components/text-file-preview';

interface FileViewerProps {
	filePath: string | null;
	content: string | undefined;
	isLoading: boolean;
	isError: boolean;
}

export function FileViewer({ filePath, content, isLoading, isError }: FileViewerProps) {
	if (!filePath) {
		return (
			<div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-2'>
				<File className='size-10 opacity-20' />
				<p className='text-sm'>Select a file to view its contents</p>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className='flex items-center justify-center h-full'>
				<Spinner />
			</div>
		);
	}

	if (isError) {
		return (
			<div className='flex flex-col items-center justify-center h-full text-muted-foreground gap-2'>
				<p className='text-sm'>Failed to load file</p>
			</div>
		);
	}

	return (
		<div className='flex flex-col h-full'>
			<div className='flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/30 text-sm text-muted-foreground shrink-0'>
				<File className='size-3.5' />
				<span className='font-mono truncate'>{getFileName(filePath)}</span>
				<span className='text-xs opacity-60 ml-auto truncate'>{filePath}</span>
			</div>
			<div className='flex-1 min-h-0'>
				<TextFilePreview filePath={filePath} content={content ?? ''} />
			</div>
		</div>
	);
}

function getFileName(filePath: string): string {
	return filePath.split('/').pop() ?? filePath;
}
