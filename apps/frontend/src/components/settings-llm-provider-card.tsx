import { Pencil, Trash2 } from 'lucide-react';
import { getDefaultModelId } from 'backend/llm';
import type { LlmProvider } from 'backend/llm';
import { Button } from '@/components/ui/button';

interface ProviderCardProps {
	provider: LlmProvider;
	apiKeyPreview?: string | null;
	baseUrl?: string | null;
	enabledModels?: string[] | null;
	isEnvProvider: boolean;
	isAdmin: boolean;
	isFormActive: boolean;
	onEdit: () => void;
	onDelete?: () => void;
	isDeleting?: boolean;
	getModelDisplayName: (provider: LlmProvider, modelId: string) => string;
}

export function ProviderCard({
	provider,
	apiKeyPreview,
	baseUrl,
	enabledModels,
	isEnvProvider,
	isAdmin,
	isFormActive,
	onEdit,
	onDelete,
	isDeleting,
	getModelDisplayName,
}: ProviderCardProps) {
	return (
		<div className='p-4 rounded-lg border border-border bg-muted/30'>
			<div className='flex items-center gap-4'>
				<div className='flex-1 grid gap-1'>
					<div className='flex items-center gap-2'>
						<span className='text-sm font-medium text-foreground capitalize'>{provider}</span>
						{isEnvProvider && (
							<span className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground'>
								ENV
							</span>
						)}
					</div>
					{apiKeyPreview ? (
						<div className='flex items-center gap-2 text-xs text-muted-foreground'>
							<span className='font-mono'>{apiKeyPreview}</span>
							{baseUrl && (
								<>
									<span className='text-border'>•</span>
									<span className='truncate max-w-[150px]' title={baseUrl}>
										Custom URL
									</span>
								</>
							)}
						</div>
					) : (
						<span className='text-xs text-muted-foreground'>API key from environment</span>
					)}
				</div>
				{isAdmin && (
					<div className='flex items-center gap-1'>
						<Button variant='ghost' size='icon-sm' onClick={onEdit} disabled={isFormActive}>
							<Pencil className='size-3 text-muted-foreground' />
						</Button>
						{onDelete && (
							<Button
								variant='ghost'
								size='icon-sm'
								onClick={onDelete}
								disabled={isDeleting || isFormActive}
							>
								<Trash2 className='size-4 text-destructive' />
							</Button>
						)}
					</div>
				)}
			</div>
			<div className='mt-3 pt-3 border-t border-border/50'>
				{enabledModels && enabledModels.length > 0 ? (
					<>
						<span className='text-xs text-muted-foreground'>Enabled models:</span>
						<div className='flex flex-wrap gap-1.5 mt-1.5'>
							{enabledModels.map((modelId) => (
								<span key={modelId} className='px-2 py-0.5 text-xs rounded bg-primary/10 text-primary'>
									{getModelDisplayName(provider, modelId)}
								</span>
							))}
						</div>
					</>
				) : (
					<span className='text-xs text-muted-foreground'>Default model: {getDefaultModelId(provider)}</span>
				)}
			</div>
		</div>
	);
}
