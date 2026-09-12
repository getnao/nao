import { isMicrosoftEntraGroupId, normalizeSsoGroupIdentifiers } from '@nao/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { SsoGroupProvider } from '@nao/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface UserGroupSsoMappingProps {
	identifiers: string[];
	provider: SsoGroupProvider;
	providerName: string;
	onChange: (identifiers: string[]) => void;
}

export function UserGroupSsoMapping({ identifiers, provider, providerName, onChange }: UserGroupSsoMappingProps) {
	const [draft, setDraft] = useState('');
	const normalizedDraft = normalizeSsoGroupIdentifiers(provider, [draft])[0];
	const identifierLabel = provider === 'microsoft' ? 'Microsoft Entra group object ID' : `${providerName} group name`;
	const isValidDraft = !!normalizedDraft && (provider !== 'microsoft' || isMicrosoftEntraGroupId(normalizedDraft));

	const addIdentifier = () => {
		if (!normalizedDraft || !isValidDraft) {
			return;
		}
		onChange(normalizeSsoGroupIdentifiers(provider, [...identifiers, normalizedDraft]));
		setDraft('');
	};

	return (
		<section className='flex flex-col gap-3'>
			<div>
				<h3 className='text-sm font-medium'>SSO group mapping — {providerName}</h3>
				<p className='text-xs text-muted-foreground'>
					Members of any listed {providerName} group are assigned to this nao group when they log in.
				</p>
			</div>
			<div className='flex gap-2'>
				<Input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							addIdentifier();
						}
					}}
					placeholder={identifierLabel}
					aria-label={identifierLabel}
					aria-invalid={!!normalizedDraft && !isValidDraft}
					maxLength={255}
					className='min-w-0'
				/>
				<Button
					type='button'
					variant='outline'
					className='shrink-0 rounded-full'
					onClick={addIdentifier}
					disabled={!isValidDraft}
				>
					Add group
				</Button>
			</div>
			{!!normalizedDraft && !isValidDraft && (
				<p className='text-xs text-destructive'>Enter a valid Microsoft Entra group object ID.</p>
			)}
			{identifiers.length > 0 && (
				<ul className='rounded-lg border'>
					{identifiers.map((identifier) => (
						<li
							key={identifier}
							className='flex min-h-10 items-center gap-2 border-b px-3 py-1.5 last:border-b-0'
						>
							<span className='min-w-0 flex-1 break-all text-sm'>{identifier}</span>
							<Button
								type='button'
								size='icon'
								variant='ghost'
								className='size-7 shrink-0 rounded-full'
								aria-label={`Remove ${providerName} group ${identifier}`}
								onClick={() => onChange(identifiers.filter((saved) => saved !== identifier))}
							>
								<X className='size-3.5' />
							</Button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
