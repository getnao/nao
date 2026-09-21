import { AlertTriangle, Loader2, X } from 'lucide-react';

import type { Attachment } from '@/hooks/use-attachment-upload';
import { AttachmentFileIcon } from '@/components/attachment-file-icon';
import { cn, formatBytes } from '@/lib/utils';

interface ChatInputAttachmentPreviewProps {
	attachments: Attachment[];
	rejection?: string;
	onRemove: (id: string) => void;
}

export function ChatInputAttachmentPreview({ attachments, rejection, onRemove }: ChatInputAttachmentPreviewProps) {
	const isVisible = attachments.length > 0 || !!rejection;

	return (
		<div
			className='grid w-full transition-[grid-template-rows] duration-200 ease-out'
			style={{ gridTemplateRows: isVisible ? '1fr' : '0fr' }}
		>
			<div className='overflow-hidden'>
				<div className='flex gap-2 px-3 pt-3 pb-1 flex-wrap justify-start items-start'>
					{attachments.map((attachment) =>
						attachment.kind === 'image' ? (
							<ImagePreview key={attachment.id} attachment={attachment} onRemove={onRemove} />
						) : (
							<DocumentPreview key={attachment.id} attachment={attachment} onRemove={onRemove} />
						),
					)}
				</div>
				{rejection && (
					<p className='flex items-start gap-1.5 px-3 pb-1 text-xs text-muted-foreground'>
						<AlertTriangle className='size-3.5 shrink-0 mt-px text-amber-500' />
						{rejection}
					</p>
				)}
			</div>
		</div>
	);
}

function ImagePreview({ attachment, onRemove }: { attachment: Attachment; onRemove: (id: string) => void }) {
	return (
		<PreviewShell attachment={attachment} onRemove={onRemove}>
			{attachment.error ? (
				<div className='size-16 rounded-lg border border-destructive/50 flex flex-col gap-1 items-center justify-center px-1 text-center'>
					<AlertTriangle className='size-4 text-destructive' />
					<span className='line-clamp-2 text-[10px] leading-tight text-destructive'>{attachment.error}</span>
				</div>
			) : attachment.dataUrl ? (
				<img src={attachment.dataUrl} alt='' className='size-16 rounded-lg object-cover border border-border' />
			) : (
				<div className='size-16 rounded-lg border border-border flex items-center justify-center'>
					<Loader2 className='size-4 animate-spin text-muted-foreground' />
				</div>
			)}
		</PreviewShell>
	);
}

function DocumentPreview({ attachment, onRemove }: { attachment: Attachment; onRemove: (id: string) => void }) {
	const isUploading = !attachment.path && !attachment.error;

	return (
		<PreviewShell attachment={attachment} onRemove={onRemove}>
			<div
				className={cn(
					'flex h-16 max-w-56 items-center gap-2 rounded-lg border border-border px-2.5',
					attachment.error && 'border-destructive/50',
				)}
			>
				{isUploading ? (
					<Loader2 className='size-4 shrink-0 animate-spin text-muted-foreground' />
				) : (
					<AttachmentFileIcon fileName={attachment.name} className='size-4 shrink-0' />
				)}
				<div className='min-w-0'>
					<p className='truncate text-xs font-medium'>{attachment.name}</p>
					<p
						className={cn(
							'truncate text-[11px]',
							attachment.error ? 'text-destructive' : 'text-muted-foreground',
						)}
					>
						{attachment.error ??
							(isUploading
								? 'Uploading...'
								: attachment.size === undefined
									? 'Saved file'
									: formatBytes(attachment.size))}
					</p>
				</div>
			</div>
		</PreviewShell>
	);
}

function PreviewShell({
	attachment,
	onRemove,
	children,
}: {
	attachment: Attachment;
	onRemove: (id: string) => void;
	children: React.ReactNode;
}) {
	return (
		<div className='relative group/preview animate-in fade-in zoom-in-75 duration-200'>
			{children}
			<button
				type='button'
				aria-label={`Remove ${attachment.name}`}
				onClick={() => onRemove(attachment.id)}
				className='absolute -top-1.5 -right-1.5 size-5 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity cursor-pointer'
			>
				<X className='size-3' />
			</button>
		</div>
	);
}
