import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function TwoFactorBackupCodes({ codes }: { codes: string[] }) {
	const [copied, setCopied] = useState(false);

	const copyCodes = async () => {
		await navigator.clipboard.writeText(codes.join('\n'));
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className='flex flex-col gap-3'>
			<div className='grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/50 p-3 font-mono text-sm'>
				{codes.map((code) => (
					<span key={code} className='text-center'>
						{code}
					</span>
				))}
			</div>
			<Button variant='outline' size='sm' className='self-start rounded-full' onClick={copyCodes}>
				{copied ? <Check className='size-3.5' /> : <Copy className='size-3.5' />}
				{copied ? 'Copied' : 'Copy codes'}
			</Button>
		</div>
	);
}
