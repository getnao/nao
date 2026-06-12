import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

interface RecommendationManualFixPanelProps {
	title: string;
	guidance: string | null;
	prompt: string | null;
}

export function RecommendationManualFixPanel({ title, guidance, prompt }: RecommendationManualFixPanelProps) {
	const { isCopied, copy } = useCopyToClipboard();

	return (
		<div className='flex h-full min-h-0 flex-col bg-background'>
			<div className='shrink-0 border-b px-4 py-3'>
				<div className='text-xs font-medium text-muted-foreground'>How to fix</div>
				<div className='truncate text-sm font-semibold' title={title}>
					{title}
				</div>
			</div>

			<div className='min-h-0 flex-1 overflow-auto p-4'>
				<div className='flex flex-col gap-4'>
					<p className='text-sm text-muted-foreground'>
						This change targets an auto-generated file, so nao can&apos;t open a pull request directly.
						Apply it at the source, or paste the prompt below into your own coding assistant.
					</p>

					{guidance && (
						<div className='flex flex-col gap-1.5'>
							<div className='text-xs font-medium text-muted-foreground'>What to do</div>
							<p className='text-sm whitespace-pre-wrap'>{guidance}</p>
						</div>
					)}

					{prompt && (
						<div className='flex flex-col gap-1.5'>
							<div className='flex items-center justify-between'>
								<div className='text-xs font-medium text-muted-foreground'>
									Prompt for your coding LLM
								</div>
								<Button size='sm' variant='outline' onClick={() => copy(prompt)}>
									{isCopied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
									{isCopied ? 'Copied' : 'Copy'}
								</Button>
							</div>
							<pre className='overflow-auto rounded-md border bg-muted/40 p-3 text-xs whitespace-pre-wrap'>
								{prompt}
							</pre>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
