import { createFileRoute } from '@tanstack/react-router';

import { ChatsReplayPage } from '@/components/settings/chats-replay-page';
import { requireAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/chats-replay')({
	validateSearch: (search: Record<string, unknown>): { chatId?: string } => ({
		chatId: typeof search.chatId === 'string' ? search.chatId : undefined,
	}),
	beforeLoad: requireAdmin,
	component: ChatsReplayPage,
});
