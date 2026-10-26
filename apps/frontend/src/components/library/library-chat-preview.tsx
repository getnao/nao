import { ExternalLink, Users } from 'lucide-react';
import type { LibraryItem, MockChatMessage } from '@/lib/library';
import { Button } from '@/components/ui/button';
import { getTimeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';

/** Read-only transcript of a chat someone shared with the user. */
export function LibraryChatPreview({ item, messages }: { item: LibraryItem; messages: MockChatMessage[] }) {
	return (
		<div className='flex h-full min-h-0 flex-col'>
			<div className='flex shrink-0 items-center gap-2 border-b bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground'>
				<Users className='size-3.5' />
				<span className='flex-1'>
					Shared by {item.sharedBy} · {getTimeAgo(item.updatedAt).humanReadable} · read-only
				</span>
				<Button variant='outline' size='sm' className='h-7 gap-1.5 rounded-full text-xs'>
					<ExternalLink className='size-3' />
					Open chat
				</Button>
			</div>
			<div className='min-h-0 flex-1 overflow-y-auto'>
				<div className='mx-auto flex max-w-2xl flex-col gap-4 px-6 py-6'>
					{messages.map((message, index) => (
						<div
							key={index}
							className={cn(
								'text-sm leading-6',
								message.role === 'user'
									? 'ml-auto max-w-[80%] rounded-2xl bg-muted px-4 py-2'
									: 'max-w-full',
							)}
						>
							{message.text}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
