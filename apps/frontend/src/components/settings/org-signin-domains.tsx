import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';

import { trpc } from '@/main';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';

interface OrgSignInDomainsProps {
	isAdmin: boolean;
}

export function OrgSignInDomains({ isAdmin }: OrgSignInDomainsProps) {
	const queryClient = useQueryClient();
	const signInDomains = useQuery(trpc.organization.getSignInDomains.queryOptions());
	const updateDomains = useMutation(trpc.organization.updateSignInDomains.mutationOptions());

	const [domains, setDomains] = useState<string[]>([]);
	const [draft, setDraft] = useState('');

	const savedDomains = useMemo(() => signInDomains.data?.domains ?? [], [signInDomains.data]);

	useEffect(() => {
		setDomains(savedDomains);
	}, [savedDomains]);

	const save = async (nextDomains: string[]) => {
		setDomains(nextDomains);
		try {
			const saved = await updateDomains.mutateAsync({ domains: nextDomains });
			setDomains(saved.domains);
			await queryClient.invalidateQueries({
				queryKey: trpc.organization.getSignInDomains.queryOptions().queryKey,
			});
		} catch {
			setDomains(savedDomains);
		}
	};

	const addDraft = () => {
		const next = draft.trim().toLowerCase().replace(/^@/, '');
		setDraft('');
		if (next && !domains.includes(next)) {
			void save([...domains, next]);
		}
	};

	const removeDomain = (domain: string) => {
		void save(domains.filter((d) => d !== domain));
	};

	return (
		<SettingsCard
			title='Sign-in domains'
			description='Anyone who signs in with Google using one of these email domains automatically joins this organization. You can only add a domain once this organization has a verified member using it, and each domain can belong to a single organization.'
		>
			{!isAdmin ? (
				<p className='text-sm text-muted-foreground'>Contact your admin to manage sign-in domains.</p>
			) : (
				<div className='flex flex-col gap-4'>
					{updateDomains.error ? (
						<p className='text-sm text-destructive'>{updateDomains.error.message}</p>
					) : null}
					<div className='flex items-center gap-2'>
						<Input
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ',') {
									e.preventDefault();
									addDraft();
								}
							}}
							placeholder='company.com'
							className='flex-1'
							disabled={updateDomains.isPending}
						/>
						<Button
							variant='secondary'
							type='button'
							onClick={addDraft}
							disabled={!draft.trim() || updateDomains.isPending}
						>
							<Plus className='size-4' />
							Add
						</Button>
					</div>

					<div className='flex flex-wrap gap-2'>
						{domains.length === 0 ? (
							<p className='text-sm text-muted-foreground'>No sign-in domains configured yet.</p>
						) : (
							domains.map((domain) => (
								<span
									key={domain}
									className='flex items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 pl-3 pr-1.5 text-sm'
								>
									{domain}
									<button
										type='button'
										onClick={() => removeDomain(domain)}
										disabled={updateDomains.isPending}
										className='rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'
										aria-label={`Remove ${domain}`}
									>
										<X className='size-3.5' />
									</button>
								</span>
							))
						)}
					</div>
				</div>
			)}
		</SettingsCard>
	);
}
