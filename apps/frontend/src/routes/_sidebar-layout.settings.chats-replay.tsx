import { createFileRoute } from '@tanstack/react-router';

import { RequireProjectRole } from '@/components/auth/require-project-role';
import { ChatsReplayPage } from '@/components/settings/chats-replay-page';

export const Route = createFileRoute('/_sidebar-layout/settings/chats-replay')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<div className='flex flex-col flex-1 min-h-0'>
			<RequireProjectRole role='admin'>
				<ChatsReplayPage />
			</RequireProjectRole>
		</div>
	);
}
