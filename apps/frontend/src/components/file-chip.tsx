import { Download, Loader2 } from 'lucide-react';

import { AttachmentFileIcon } from '@/components/attachment-file-icon';
import { AttachmentViewer } from '@/components/side-panel/attachment-viewer';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useSidePanel } from '@/contexts/side-panel';
import { useAttachmentDownload } from '@/hooks/use-attachment-download';
import { fileNameOf } from '@/lib/attachments';
import { cn } from '@/lib/utils';

interface FileChipProps {
	/** Virtual path in permanent storage, e.g. `/home/exports/churn-2025.csv`. */
	path: string;
	/** Shown instead of the file name in the path. */
	label?: string;
	className?: string;
}

/**
 * A file in permanent storage: opens in the side panel, or downloads straight away. On a chat
 * someone else shared it is inert, since those files stay in the owner's storage.
 */
export function FileChip({ path, label, className }: FileChipProps) {
	const { open, isReadonlyMode } = useSidePanel();
	const download = useAttachmentDownload(path);
	const fileName = label ?? fileNameOf(path);

	const name = (
		<>
			<AttachmentFileIcon fileName={path} className='size-3.5 shrink-0' />
			<span className='truncate text-xs'>{fileName}</span>
		</>
	);

	if (isReadonlyMode) {
		return (
			<SimpleTooltip content={path}>
				<span className={cn(chipClassName, 'gap-1.5 px-2 py-1', className)}>{name}</span>
			</SimpleTooltip>
		);
	}

	return (
		<span className={cn(chipClassName, 'gap-1 py-0.5 pl-2 pr-0.5 transition-colors hover:bg-accent', className)}>
			<SimpleTooltip content={path}>
				<button
					type='button'
					onClick={() => open(<AttachmentViewer path={path} fileName={fileName} />)}
					className='flex min-w-0 cursor-pointer items-center gap-1.5 py-0.5'
				>
					{name}
				</button>
			</SimpleTooltip>
			<SimpleTooltip content={download.error?.message ?? 'Download'}>
				<Button
					variant='ghost-muted'
					size='icon-xs'
					className='hover:rounded-full'
					aria-label={`Download ${fileName}`}
					disabled={download.isPending}
					onClick={() => download.mutate()}
				>
					{download.isPending ? <Loader2 className='animate-spin' /> : <Download />}
				</Button>
			</SimpleTooltip>
		</span>
	);
}

const chipClassName =
	'inline-flex max-w-56 items-center rounded-lg border border-border bg-background align-middle text-foreground';
