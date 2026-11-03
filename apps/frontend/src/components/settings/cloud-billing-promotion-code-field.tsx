import { CheckIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function CloudBillingPromotionCodeField({
	id,
	value,
	applied,
	disabled,
	applyDisabled,
	onChange,
	onApply,
}: {
	id: string;
	value: string;
	applied: boolean;
	disabled?: boolean;
	applyDisabled?: boolean;
	onChange: (value: string) => void;
	onApply: () => void;
}) {
	return (
		<div className='space-y-1.5 border-t border-border pt-3'>
			<label htmlFor={id} className='text-xs font-medium text-muted-foreground'>
				Promotion code <span className='font-normal'>(optional)</span>
			</label>
			<div className='flex flex-col gap-2 sm:flex-row'>
				<Input
					id={id}
					autoComplete='off'
					maxLength={200}
					placeholder='Optional'
					value={value}
					disabled={disabled}
					className='h-8 text-sm'
					onChange={(event) => onChange(event.target.value)}
				/>
				{applied ? (
					<div
						className='flex h-8 shrink-0 items-center gap-1.5 px-2 text-xs font-medium text-emerald-600'
						role='status'
					>
						<CheckIcon className='size-3.5' aria-hidden='true' />
						Valid
					</div>
				) : (
					<Button variant='secondary' size='sm' disabled={disabled || applyDisabled} onClick={onApply}>
						Apply code
					</Button>
				)}
			</div>
			<p className='text-xs text-muted-foreground'>A new code replaces the current discount.</p>
		</div>
	);
}
