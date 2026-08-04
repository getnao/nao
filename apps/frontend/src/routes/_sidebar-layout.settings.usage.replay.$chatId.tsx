import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Check, Link } from 'lucide-react';

import { ChatsReplayPanel } from '@/components/settings/chats-replay-panel';
import { validateUsageSearch } from '@/components/settings/usage-route-search';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { requireContextAdminOrAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/usage/replay/$chatId')({
	beforeLoad: requireContextAdminOrAdmin,
	validateSearch: validateUsageSearch,
	component: ChatReplayRoute,
});

function ChatReplayRoute() {
	const { chatId } = Route.useParams();
	const usageSearch = Route.useSearch();
	const navigate = useNavigate();
	const { isCopied, copy } = useCopyToClipboard();

	return (
		<ChatsReplayPanel
			chatId={chatId}
			highlightOnLoad={usageSearch.highlight}
			targetId={usageSearch.targetId}
			metadataAction={
				<button
					type='button'
					className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
					onClick={() => copy(window.location.href).catch(console.error)}
				>
					{isCopied ? <Check className='size-3' /> : <Link className='size-3' />}
					{isCopied ? 'Copied!' : 'Copy link'}
				</button>
			}
			onBack={() => {
				if (usageSearch.origin === 'recommendations') {
					navigate({
						to: '/settings/recommendations',
						search: { tab: usageSearch.recoTab, openChats: usageSearch.recoId },
						replace: true,
					});
					return;
				}
				navigate({
					to: '/settings/usage',
					search: usageSearch,
					replace: true,
				});
			}}
		/>
	);
}
