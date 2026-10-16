import { ScrollText, Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';

export function AgentPromptCard({ prompt }: { prompt: string }) {
	const { isCopied, copy } = useCopyToClipboard();
	const [copyFailed, setCopyFailed] = useState(false);
	const copyLabel = copyFailed ? 'Copy failed' : isCopied ? 'Copied' : 'Copy prompt';

	const handleCopy = async () => {
		setCopyFailed(false);
		try {
			await copy(prompt);
		} catch {
			setCopyFailed(true);
		}
	};

	return (
		<div className='rounded-xl border border-border bg-background px-4 py-3'>
			<div className='flex items-start gap-2'>
				<ScrollText className='size-4 shrink-0' />
				<div className='flex min-w-0 flex-1 flex-col gap-0.5'>
					<span className='text-xs font-medium uppercase tracking-wide'>Local agent prompt</span>
					<p className='text-xs text-muted-foreground leading-relaxed'>
						Open your coding agent in the project folder, then paste this prompt.
					</p>
				</div>
				<Button
					type='button'
					variant='ghost-muted'
					size='icon-xs'
					aria-label={copyLabel}
					title={copyLabel}
					onClick={() => void handleCopy()}
				>
					{isCopied && !copyFailed ? <Check className='text-emerald-500' /> : <Copy />}
				</Button>
			</div>
			<div className='mt-3 border-t border-border pt-3 pl-6'>
				<PromptText prompt={prompt} />
			</div>
			{copyFailed && (
				<p role='status' className='mt-2 text-xs text-destructive'>
					Prompt was not copied
				</p>
			)}
		</div>
	);
}

function PromptText({ prompt }: { prompt: string }) {
	return (
		<div className='max-h-80 overflow-y-auto pr-2'>
			{prompt.split('\n').map((line, index) => {
				const text = line.trim();

				if (!text) {
					return <div key={index} aria-hidden className='h-2' />;
				}

				if (/^[A-Z][A-Z\s]+$/.test(text)) {
					return (
						<p key={index} className='text-sm font-medium leading-5'>
							{text}
						</p>
					);
				}

				if (/^(?:npx|uv|pip|unset|nao)\b/.test(text)) {
					return (
						<code key={index} className='block break-words font-mono text-xs leading-5'>
							{text}
						</code>
					);
				}

				return (
					<p key={index} className='text-sm leading-5'>
						{text}
					</p>
				);
			})}
		</div>
	);
}
