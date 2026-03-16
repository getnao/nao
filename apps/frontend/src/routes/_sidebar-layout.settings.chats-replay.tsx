import { createFileRoute } from '@tanstack/react-router';

import { ChatsReplayPage } from '@/components/settings/chats-replay-page';
import { requireAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/chats-replay')({
	beforeLoad: requireAdmin,
	component: ChatsReplayPage,
});
