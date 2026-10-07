import { useMemo } from 'react';
import type { MessageModel } from '@nao/backend/chat';
import type { MessageModelMap } from '@/components/chat-messages/chat-messages-readonly';
import { MessageModelDetails } from '@/components/chat-messages/message-model-label';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SimpleTooltip } from '@/components/ui/tooltip';

interface ModelUsage {
	model: MessageModel;
	messageCount: number;
}

export function ReplayConversationModels({ messageModels }: { messageModels: MessageModelMap }) {
	const usages = useMemo(() => summarizeModelUsages(messageModels), [messageModels]);
	const [mainUsage, ...otherUsages] = usages;

	if (!mainUsage) {
		return null;
	}

	return (
		<SimpleTooltip content={<ModelUsageList usages={usages} />}>
			<span className='flex items-center gap-1.5 px-2 text-xs text-muted-foreground'>
				<LlmProviderIcon provider={mainUsage.model.provider} className='size-3.5' />
				{mainUsage.model.name}
				{otherUsages.length > 0 && <span>+{otherUsages.length}</span>}
			</span>
		</SimpleTooltip>
	);
}

function ModelUsageList({ usages }: { usages: ModelUsage[] }) {
	return (
		<div className='flex flex-col gap-1'>
			{usages.map((usage) => (
				<div key={modelKey(usage.model)} className='flex items-center justify-between gap-4'>
					<MessageModelDetails model={usage.model} />
					<span className='tabular-nums opacity-70'>
						{usage.messageCount} {usage.messageCount === 1 ? 'message' : 'messages'}
					</span>
				</div>
			))}
		</div>
	);
}

/** Models ordered from the most used to the least used, ties keeping the order in which they were first used. */
function summarizeModelUsages(messageModels: MessageModelMap): ModelUsage[] {
	const usagesByModel = new Map<string, ModelUsage>();
	for (const model of Object.values(messageModels)) {
		const key = modelKey(model);
		const usage = usagesByModel.get(key);
		if (usage) {
			usage.messageCount += 1;
		} else {
			usagesByModel.set(key, { model, messageCount: 1 });
		}
	}
	return [...usagesByModel.values()].sort((left, right) => right.messageCount - left.messageCount);
}

function modelKey(model: MessageModel): string {
	return `${model.provider}:${model.modelId}`;
}
