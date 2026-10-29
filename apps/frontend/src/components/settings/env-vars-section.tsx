import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/main';

interface EnvVarsSectionProps {
	isAdmin: boolean;
	unstyled?: boolean;
	onSaved?: (envVars: Record<string, string>) => void;
}

export function EnvVarsSection({ isAdmin, unstyled = false, onSaved }: EnvVarsSectionProps) {
	const queryClient = useQueryClient();
	const envVarsQuery = useQuery(trpc.project.getEnvVars.queryOptions());
	const [localValues, setLocalValues] = useState<Record<string, string>>({});
	const [hasChanges, setHasChanges] = useState(false);
	const initializedRef = useRef(false);

	useEffect(() => {
		if (envVarsQuery.data && !initializedRef.current) {
			setLocalValues(envVarsQuery.data.values);
			initializedRef.current = true;
		}
	}, [envVarsQuery.data]);

	const updateMutation = useMutation({
		...trpc.project.updateEnvVars.mutationOptions(),
		onSuccess: (_data, variables) => {
			initializedRef.current = false;
			queryClient.invalidateQueries({ queryKey: trpc.project.getEnvVars.queryKey() });
			setHasChanges(false);
			onSaved?.(variables.envVars);
		},
	});

	if (envVarsQuery.isLoading) {
		return (
			<SettingsCard title='Environment Variables'>
				<div className='space-y-3'>
					<Skeleton className='h-4 w-48' />
					<Skeleton className='h-9 w-full' />
					<Skeleton className='h-9 w-full' />
				</div>
			</SettingsCard>
		);
	}

	const required = envVarsQuery.data?.required ?? [];
	const setFromProcessEnv = new Set(envVarsQuery.data?.setFromProcessEnv ?? []);
	if (required.length === 0) {
		return null;
	}

	const handleChange = (key: string, value: string) => {
		setLocalValues((prev) => ({ ...prev, [key]: value }));
		setHasChanges(true);
	};

	const handleSave = () => {
		const envVars: Record<string, string> = {};
		for (const key of required) {
			const val = localValues[key];
			if (val) {
				envVars[key] = val;
			}
		}
		updateMutation.mutate({ envVars });
	};

	return (
		<SettingsCard
			title='Environment Variables'
			description='Variables referenced in nao_config.yaml via {{ env("...") }} or in agent/mcps/mcp.json via ${...}.'
			unstyled={unstyled}
			action={
				isAdmin && hasChanges ? (
					<Button size='sm' onClick={handleSave} disabled={updateMutation.isPending}>
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
			<div className='grid gap-4'>
				{required.map((key) => {
					const value = localValues[key] ?? '';
					const isFromProcessEnv = setFromProcessEnv.has(key);
					const isSet = isFromProcessEnv || !!value;
					const isEditable = isAdmin && !isFromProcessEnv;
					const inputId = `env-var-${key}`;

					return (
						<div key={key} className='grid gap-1.5'>
							<div className='flex items-center gap-2'>
								<label htmlFor={inputId} className='text-sm font-medium text-foreground'>
									{key}
								</label>
								{!isEditable && (
									<span className='text-xs text-muted-foreground'>
										{getStatusLabel(isFromProcessEnv, isSet)}
									</span>
								)}
							</div>
							{isEditable ? (
								<Input
									id={inputId}
									type='password'
									autoComplete='new-password'
									value={value}
									onChange={(e) => handleChange(key, e.target.value)}
									placeholder='Enter value...'
									className='font-mono'
								/>
							) : (
								<Input
									id={inputId}
									value={isSet ? '••••••••' : ''}
									readOnly
									className='bg-muted/50 font-mono'
									placeholder='Not configured'
								/>
							)}
						</div>
					);
				})}
			</div>
			{updateMutation.error && <ErrorMessage message={updateMutation.error.message} />}
		</SettingsCard>
	);
}

function getStatusLabel(isFromProcessEnv: boolean, isSet: boolean): string {
	if (isFromProcessEnv) {
		return '(set from environment)';
	}
	return isSet ? '(configured)' : '(not set)';
}
