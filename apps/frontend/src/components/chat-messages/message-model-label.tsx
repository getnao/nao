import { providerLabel } from '@nao/shared/types';
import type { MessageModel } from '@nao/backend/chat';
import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { SimpleTooltip } from '@/components/ui/tooltip';

export function MessageModelLabel({ model }: { model: MessageModel }) {
	return (
		<SimpleTooltip content={<MessageModelDetails model={model} />} side='bottom' align='start'>
			<span className='flex w-fit items-center gap-1.5 text-xs text-muted-foreground'>
				<LlmProviderIcon provider={model.provider} className='size-3' />
				{model.name}
			</span>
		</SimpleTooltip>
	);
}

export function MessageModelDetails({ model }: { model: MessageModel }) {
	return (
		<span>
			{providerLabel(model.provider)} · <span className='font-mono'>{model.modelId}</span>
		</span>
	);
}
