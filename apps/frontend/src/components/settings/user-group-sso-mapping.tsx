import { isMicrosoftEntraGroupId, normalizeSsoGroupIdentifiers } from '@nao/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { SsoGroupProvider } from '@nao/shared';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

export interface EffectiveEnvMapping {
	identifier: string;
	targetGroupId: string | null;
	targetGroupName: string;
}

interface UserGroupSsoMappingProps {
	identifiers: string[];
	provider: SsoGroupProvider;
	providerName: string;
	currentGroupId?: string;
	effectiveEnvMappings?: EffectiveEnvMapping[];
	envMappingsState?: 'ready' | 'loading' | 'error';
	onRetryEnvMappings?: () => void;
	configurationState?: 'ready' | 'loading' | 'error' | 'unavailable';
	onRetryConfiguration?: () => void;
	onChange: (identifiers: string[]) => void;
}

const MAX_SSO_GROUP_IDENTIFIERS = 200;

export function UserGroupSsoMapping({
	identifiers,
	provider,
	providerName,
	currentGroupId,
	effectiveEnvMappings = [],
	envMappingsState = 'ready',
	onRetryEnvMappings,
	configurationState = 'ready',
	onRetryConfiguration,
	onChange,
}: UserGroupSsoMappingProps) {
	const [draft, setDraft] = useState('');
	const normalizedDraft = normalizeSsoGroupIdentifiers(provider, [draft])[0];
	const identifierLabel = provider === 'microsoft' ? 'Microsoft Entra group object ID' : `${providerName} group name`;
	const isValidDraft = !!normalizedDraft && (provider !== 'microsoft' || isMicrosoftEntraGroupId(normalizedDraft));
	const isAtLimit = identifiers.length >= MAX_SSO_GROUP_IDENTIFIERS;
	const canAdd = configurationState === 'ready' && !isAtLimit;
	const feedbackId = `sso-group-mapping-${provider}-feedback`;
	const envMappingsByIdentifier = new Map(effectiveEnvMappings.map((mapping) => [mapping.identifier, mapping]));
	const editableIdentifiers = identifiers.filter((identifier) => {
		const envMapping = envMappingsByIdentifier.get(identifier);
		return !envMapping || envMapping.targetGroupId !== currentGroupId;
	});
	const currentGroupEnvMappings = effectiveEnvMappings.filter((mapping) => mapping.targetGroupId === currentGroupId);

	const addIdentifier = () => {
		if (!normalizedDraft || !isValidDraft || !canAdd) {
			return;
		}
		onChange(normalizeSsoGroupIdentifiers(provider, [...identifiers, normalizedDraft]));
		setDraft('');
	};

	return (
		<section className='flex flex-col gap-3'>
			<div>
				<h3 className='text-sm font-medium'>SSO group mapping: {providerName}</h3>
				<p className='text-xs text-muted-foreground'>
					Members of any listed {providerName} group are assigned to this nao group when they log in.
				</p>
			</div>
			{configurationState === 'ready' ? (
				<>
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
							aria-describedby={isAtLimit ? feedbackId : undefined}
							maxLength={255}
							className='min-w-0'
						/>
						<Button
							type='button'
							variant='outline'
							className='shrink-0 rounded-full'
							onClick={addIdentifier}
							disabled={!isValidDraft || isAtLimit}
							aria-describedby={isAtLimit ? feedbackId : undefined}
						>
							Add group
						</Button>
					</div>
					{!!normalizedDraft && !isValidDraft && (
						<p className='text-xs text-destructive'>Enter a valid Microsoft Entra group object ID.</p>
					)}
					{isAtLimit && (
						<p id={feedbackId} role='status' className='text-xs text-muted-foreground'>
							Maximum of 200 groups reached. Remove one to add another.
						</p>
					)}
				</>
			) : (
				<SsoConfigurationNotice
					state={configurationState}
					providerName={providerName}
					onRetry={onRetryConfiguration}
				/>
			)}
			{envMappingsState !== 'ready' && (
				<EnvMappingsNotice state={envMappingsState} onRetry={onRetryEnvMappings} />
			)}
			{(editableIdentifiers.length > 0 || currentGroupEnvMappings.length > 0) && (
				<ul className='rounded-lg border'>
					{editableIdentifiers.map((identifier) => {
						const overridingMapping = envMappingsByIdentifier.get(identifier);
						return (
							<li
								key={identifier}
								className='flex min-h-10 items-center gap-2 border-b px-3 py-1.5 last:border-b-0'
							>
								<span
									className={`min-w-0 flex-1 break-all text-sm ${
										overridingMapping ? 'text-muted-foreground' : ''
									}`}
									aria-label={
										overridingMapping
											? `${providerName} group ${identifier} inactive. Overridden by .env to ${overridingMapping.targetGroupName}`
											: undefined
									}
								>
									{identifier}
								</span>
								{overridingMapping && (
									<Badge
										variant='secondary'
										className='max-w-64 overflow-hidden text-ellipsis'
										aria-label={`Overridden by .env to ${overridingMapping.targetGroupName}`}
									>
										Overridden by .env → maps to {overridingMapping.targetGroupName}
									</Badge>
								)}
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
						);
					})}
					{currentGroupEnvMappings.map((mapping) => (
						<li
							key={`env:${mapping.identifier}`}
							className='flex min-h-10 items-center gap-2 border-b px-3 py-1.5 last:border-b-0'
						>
							<span className='min-w-0 flex-1 break-all text-sm'>{mapping.identifier}</span>
							<Badge variant='secondary' aria-label='.env controlled mapping'>
								.env
							</Badge>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function EnvMappingsNotice({ state, onRetry }: { state: 'loading' | 'error'; onRetry?: () => void }) {
	return (
		<div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
			<p className={state === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
				{state === 'loading' ? 'Loading .env mappings...' : 'Failed to load .env mappings.'}
			</p>
			{state === 'error' && onRetry && (
				<Button type='button' variant='outline' size='sm' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}

function SsoConfigurationNotice({
	state,
	providerName,
	onRetry,
}: {
	state: 'loading' | 'error' | 'unavailable';
	providerName: string;
	onRetry?: () => void;
}) {
	const message =
		state === 'loading'
			? `Loading ${providerName} configuration...`
			: state === 'error'
				? `Failed to load ${providerName} configuration.`
				: `${providerName} is not configured. Existing mappings can still be removed.`;

	return (
		<div className='flex items-center justify-between gap-3 rounded-lg border p-3'>
			<p className={state === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
				{message}
			</p>
			{state === 'error' && onRetry && (
				<Button type='button' variant='outline' size='sm' onClick={onRetry}>
					Retry
				</Button>
			)}
		</div>
	);
}
