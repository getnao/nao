import { lazy, Suspense, useState } from 'react';
import type { LucideIcon } from 'lucide-react';

import { LucideIconByName } from '@/components/lucide-icon-by-name';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';

const IconPickerGrid = lazy(() => import('@/components/settings/icon-picker-grid'));

/** Picks any Lucide icon by name; `null` means the default icon. */
export function IconPicker({
	value,
	defaultIcon: DefaultIcon,
	label,
	onChange,
}: {
	value: string | null;
	defaultIcon: LucideIcon;
	label: string;
	onChange: (name: string | null) => void;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');

	function select(name: string | null) {
		onChange(name);
		setOpen(false);
		setQuery('');
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant='ghost' size='icon-sm' aria-label={`Change icon for ${label}`} title='Change icon'>
					<LucideIconByName name={value} fallback={DefaultIcon} className='size-4' />
				</Button>
			</PopoverTrigger>
			<PopoverContent align='start' className='flex w-80 flex-col gap-3 p-3'>
				<div className='flex items-center gap-2'>
					<Input
						autoFocus
						value={query}
						placeholder='Search icons…'
						className='h-8'
						onChange={(event) => setQuery(event.target.value)}
					/>
					<Button
						variant='outline'
						size='sm'
						disabled={value === null}
						onClick={() => select(null)}
						title='Use the default icon'
					>
						<DefaultIcon className='size-4' />
						Default
					</Button>
				</div>
				<Suspense fallback={<IconGridLoading />}>
					<IconPickerGrid query={query} selectedName={value} onSelect={select} />
				</Suspense>
			</PopoverContent>
		</Popover>
	);
}

function IconGridLoading() {
	return (
		<div className='flex h-32 items-center justify-center'>
			<Spinner />
		</div>
	);
}
