import { createFileRoute } from '@tanstack/react-router';
import { SubagentConversation } from '@/components/subagent/subagent-conversation';

export const Route = createFileRoute('/_sidebar-layout/_chat-layout/$chatId_/subagent/$toolCallId')({
	component: RouteComponent,
});

function RouteComponent() {
	const { chatId, toolCallId } = Route.useParams();
	return <SubagentConversation chatId={chatId} toolCallId={toolCallId} />;
}
