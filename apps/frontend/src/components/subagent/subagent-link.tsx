import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useSidePanel } from '@/contexts/side-panel';

interface SubagentLinkProps {
	chatId: string;
	toolCallId: string;
	className?: string;
	children: ReactNode;
}

/** Opens a subagent run as its own conversation, staying inside the admin replay when the chat is replayed. */
export function SubagentLink({ chatId, toolCallId, className, children }: SubagentLinkProps) {
	const { isReplay } = useSidePanel();

	if (isReplay) {
		return (
			<Link
				from='/settings/usage/replay/$chatId'
				to='/settings/usage/replay/$chatId/subagent/$toolCallId'
				params={{ chatId, toolCallId }}
				search={true}
				className={className}
			>
				{children}
			</Link>
		);
	}

	return (
		<Link to='/$chatId/subagent/$toolCallId' params={{ chatId, toolCallId }} className={className}>
			{children}
		</Link>
	);
}
