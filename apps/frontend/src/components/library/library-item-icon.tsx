import { MessageSquare, Presentation, Table2 } from 'lucide-react';
import type { LibraryItem } from '@/lib/library';
import { AttachmentFileIcon } from '@/components/attachment-file-icon';
import StoryIcon from '@/components/ui/story-icon';
import { cn } from '@/lib/utils';

export function LibraryItemIcon({ item, className }: { item: LibraryItem; className?: string }) {
	switch (item.type) {
		case 'story':
			return <StoryIcon className={cn('text-violet', className)} strokeWidth={2.25} />;
		case 'query':
			return <Table2 className={cn('text-sky-500', className)} strokeWidth={2.25} />;
		case 'chat':
			return <MessageSquare className={cn('text-muted-foreground', className)} strokeWidth={2.25} />;
		case 'file':
			return item.name.endsWith('.pptx') ? (
				<Presentation className={cn('text-orange-500', className)} strokeWidth={2.25} />
			) : (
				<AttachmentFileIcon fileName={item.name} className={className} />
			);
	}
}
