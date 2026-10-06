import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { providerLabel } from '@nao/shared/types';
import type { LlmProvider } from '@nao/shared/types';

import { LlmProviderIcon } from '@/components/ui/llm-provider-icon';
import { trpc } from '@/main';

const COLLAPSED_MODEL_COUNT = 3;

type UnpricedModel = { provider: LlmProvider; modelId: string; name: string };

export function UnpricedModelsWarning() {
	const unpricedModels = useQuery(trpc.budget.getUnpricedModels.queryOptions());
	const [isExpanded, setIsExpanded] = useState(false);
	const models = unpricedModels.data ?? [];
	if (models.length === 0) {
		return null;
	}

	const visibleModels = isExpanded ? models : models.slice(0, COLLAPSED_MODEL_COUNT);
	const hiddenCount = models.length - visibleModels.length;

	return (
		<section className='rounded-xl border border-border bg-muted/30'>
			<header className='flex items-start gap-3 p-4'>
				<TriangleAlert className='size-4 shrink-0 mt-0.5 text-amber-500' />
				<div className='flex min-w-0 flex-col'>
					<h3 className='text-base font-semibold text-foreground'>
						{models.length === 1
							? '1 model is not tracked by budgets'
							: `${models.length} models are not tracked by budgets`}
					</h3>
					<p className='text-xs text-muted-foreground'>
						Their token cost is unknown, so their usage counts as $0 toward every limit. Set a cost to
						include them.
					</p>
				</div>
			</header>
			<ul className='divide-y divide-border border-t border-border'>
				{visibleModels.map((model) => (
					<UnpricedModelRow key={`${model.provider}/${model.modelId}`} model={model} />
				))}
			</ul>
			{hiddenCount > 0 && (
				<button
					type='button'
					onClick={() => setIsExpanded(true)}
					className='w-full cursor-pointer border-t border-border px-4 py-2 text-left text-xs text-muted-foreground hover:text-foreground'
				>
					Show {hiddenCount} more
				</button>
			)}
		</section>
	);
}

function UnpricedModelRow({ model }: { model: UnpricedModel }) {
	return (
		<li className='flex items-center gap-3 px-4 py-2'>
			<LlmProviderIcon provider={model.provider} className='size-4 shrink-0' />
			<div className='flex min-w-0 flex-1 items-baseline gap-2'>
				<span className='truncate text-sm text-foreground'>{model.name}</span>
				<span className='shrink-0 text-xs text-muted-foreground'>{providerLabel(model.provider)}</span>
			</div>
			<Link
				to='/settings/project/agent'
				search={{ tab: 'models', provider: model.provider, model: model.modelId }}
				className='flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground'
			>
				Set cost
				<ArrowRight className='size-3' />
			</Link>
		</li>
	);
}
