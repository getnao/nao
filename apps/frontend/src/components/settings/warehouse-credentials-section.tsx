import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, LockKeyhole } from 'lucide-react';
import { requestWarehouseCredentials } from '@nao/shared/tools';

import { Button } from '@/components/ui/button';
import { DatabaseIcon } from '@/components/ui/database-icon';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

const STORED_VALUE_MASK = '••••••••';

export function WarehouseCredentialsSection({ isAdmin }: { isAdmin: boolean }) {
	const queryClient = useQueryClient();
	const envVarsQuery = useQuery(trpc.project.getEnvVars.queryOptions());
	const [replacements, setReplacements] = useState<Record<string, string>>({});

	const updateMutation = useMutation({
		...trpc.project.updateWarehouseCredentials.mutationOptions(),
		onSuccess: () => {
			setReplacements({});
			queryClient.invalidateQueries({ queryKey: trpc.project.getEnvVars.queryKey() });
		},
	});

	const credentials = envVarsQuery.data?.warehouseCredentials;
	if (!credentials) {
		return null;
	}

	const providerLabel = requestWarehouseCredentials.WAREHOUSE_PROVIDER_LABELS[credentials.provider];
	const changedValues = Object.fromEntries(Object.entries(replacements).filter(([, value]) => value.length > 0));
	const hasChanges = Object.keys(changedValues).length > 0;

	return (
		<SettingsCard
			title='Warehouse credentials'
			description={`Your ${providerLabel} connection details are stored encrypted in nao. Enter a new value to replace one.`}
			action={
				isAdmin && hasChanges ? (
					<Button
						size='sm'
						onClick={() => updateMutation.mutate({ values: changedValues })}
						disabled={updateMutation.isPending}
					>
						{updateMutation.isPending ? (
							<Loader2 className='size-3.5 animate-spin' />
						) : (
							<Check className='size-3.5' />
						)}
						Save
					</Button>
				) : undefined
			}
		>
			<div className='flex items-center gap-2 text-sm text-muted-foreground'>
				<DatabaseIcon dialect={credentials.provider} className='size-4 shrink-0' />
				<span className='text-foreground'>{providerLabel}</span>
				<LockKeyhole className='ml-auto size-3.5 shrink-0' />
				<span className='text-xs'>Updated {new Date(credentials.updatedAt).toLocaleDateString()}</span>
			</div>
			<div className='grid gap-4'>
				{credentials.fields.map((field) => {
					const inputId = `warehouse-credential-${field.name}`;
					return (
						<div key={field.name} className='grid gap-1.5'>
							<label htmlFor={inputId} className='text-sm font-medium text-foreground'>
								{field.label}
							</label>
							<Input
								id={inputId}
								type='password'
								autoComplete='new-password'
								value={replacements[field.name] ?? ''}
								onChange={(event) =>
									setReplacements((previous) => ({ ...previous, [field.name]: event.target.value }))
								}
								readOnly={!isAdmin}
								placeholder={STORED_VALUE_MASK}
								className={isAdmin ? 'font-mono' : 'bg-muted/50 font-mono'}
							/>
						</div>
					);
				})}
			</div>
			{updateMutation.error && <ErrorMessage message={updateMutation.error.message} />}
		</SettingsCard>
	);
}
