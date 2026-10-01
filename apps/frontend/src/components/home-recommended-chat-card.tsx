import { Link } from '@tanstack/react-router';
import type { MessageBubble } from '@nao/shared/types';
import { AuthorDateLabel, GRID_CARD_CLASS, GRID_THUMBNAIL_CLASS, GridCardFooter } from '@/components/item-card';
import { ChatThumbnail } from '@/components/viewer-shared-items';

export interface RecommendedChat {
	id: string;
	shareId: string | null;
	title: string;
	authorName: string;
	createdAt: Date;
	messageBubbles?: MessageBubble[];
}

export function HomeRecommendedChatCard({ chat }: { chat: RecommendedChat }) {
	const link = chat.shareId
		? { to: '/shared-chat/$shareId' as const, params: { shareId: chat.shareId } }
		: { to: '/$chatId' as const, params: { chatId: chat.id } };

	return (
		<Link {...link} className={GRID_CARD_CLASS}>
			<div className={GRID_THUMBNAIL_CLASS}>
				<ChatThumbnail bubbles={chat.messageBubbles} />
			</div>
			<div className='absolute inset-0 flex flex-col justify-end p-2.5'>
				<GridCardFooter
					title={chat.title}
					subtitle={<AuthorDateLabel author={chat.authorName} createdAt={chat.createdAt} />}
				/>
			</div>
		</Link>
	);
}
