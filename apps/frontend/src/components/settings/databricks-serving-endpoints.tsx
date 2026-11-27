import { useMutation } from '@tanstack/react-query';
import { Loader2, Plus, RefreshCw } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { trpc } from '@/main';

export interface DatabricksConnection {
	baseUrl: string;
	apiKey: string;
	credentials: Record<string, string>;
}

interface DatabricksServingEndpointsProps {
	configId?: string;
	getConnection: () => DatabricksConnection;
	enabledModels: string[];
	onAdd: (endpoint: string) => void;
}

/**
 * Lists the chat serving endpoints of the workspace so they can be enabled as models in one click.
 * A saved config lists them as soon as it opens; a new one waits for its credentials and the button.
 */
export function DatabricksServingEndpoints({
	configId,
	getConnection,
	enabledModels,
	onAdd,
}: DatabricksServingEndpointsProps) {
	const listEndpoints = useMutation(trpc.project.listDatabricksServingEndpoints.mutationOptions());
	const endpointsToAdd = listEndpoints.data?.filter((endpoint) => !enabledModels.includes(endpoint));

	const loadEndpoints = () => {
		const { baseUrl, apiKey, credentials } = getConnection();
		listEndpoints.mutate({
			configId,
			baseUrl: baseUrl || undefined,
			apiKey: apiKey || undefined,
			credentials: Object.fromEntries(Object.entries(credentials).filter(([, value]) => value)),
		});
	};

	useEffect(() => {
		if (configId) {
			loadEndpoints();
		}
	}, [configId]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div className='grid gap-2'>
			<div className='flex items-center justify-between gap-2'>
				<span className='text-xs text-muted-foreground'>Chat serving endpoints of the workspace</span>
				<Button
					type='button'
					variant='outline'
					size='sm'
					onClick={loadEndpoints}
					disabled={listEndpoints.isPending}
				>
					{listEndpoints.isPending ? (
						<Loader2 className='size-3.5 animate-spin' />
					) : (
						<RefreshCw className='size-3.5' />
					)}
					{listEndpoints.data ? 'Reload endpoints' : 'Load endpoints'}
				</Button>
			</div>

			{endpointsToAdd && endpointsToAdd.length > 0 && (
				<div className='flex flex-wrap gap-2'>
					{endpointsToAdd.map((endpoint) => (
						<button
							key={endpoint}
							type='button'
							onClick={() => onAdd(endpoint)}
							className='flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all cursor-pointer bg-secondary text-muted-foreground hover:text-foreground'
						>
							<Plus className='size-3' />
							{endpoint}
						</button>
					))}
				</div>
			)}

			{endpointsToAdd?.length === 0 && (
				<p className='text-xs text-muted-foreground'>
					{listEndpoints.data?.length
						? 'Every chat serving endpoint is enabled.'
						: 'This workspace has no chat serving endpoint.'}
				</p>
			)}

			{listEndpoints.error && <p className='text-xs text-destructive'>{listEndpoints.error.message}</p>}
		</div>
	);
}
