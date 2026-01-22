import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CopyableUrl({ label, url }: { label: string; url: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(url);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className='grid gap-1 min-w-0'>
			<span className='text-xs text-muted-foreground'>{label}</span>
			<div className='flex items-center gap-2 min-w-0'>
				<code className='flex-1 min-w-0 text-xs font-mono bg-muted/50 px-2 py-1.5 rounded border border-border truncate'>
					{url}
				</code>
				<Button variant='ghost' size='icon-sm' onClick={handleCopy} className='shrink-0'>
					{copied ? (
						<Check className='size-3.5 text-green-500' />
					) : (
						<Copy className='size-3.5 text-muted-foreground' />
					)}
				</Button>
			</div>
		</div>
	);
}
