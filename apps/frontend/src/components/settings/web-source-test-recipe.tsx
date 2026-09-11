import { useMutation } from '@tanstack/react-query';
import { Play } from 'lucide-react';

import type { WebRobotRecipe } from '@nao/shared/web-robot';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { ErrorMessage } from '@/components/ui/error-message';
import { SettingsCard } from '@/components/ui/settings-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { trpc } from '@/main';

export function WebSourceTestRecipe({
	recipe,
	validationErrors,
}: {
	recipe?: WebRobotRecipe;
	validationErrors: string[];
}) {
	const testRecipe = useMutation(trpc.webRobot.testRecipe.mutationOptions());
	const result = testRecipe.data;
	const errorEvents = result?.events.filter((event) => event.type === 'error') ?? [];

	return (
		<SettingsCard
			title='Test recipe'
			description='Run a bounded dry run against the current recipe without publishing a dataset.'
			action={
				<Button
					type='button'
					variant='secondary'
					size='sm'
					disabled={!recipe || testRecipe.isPending}
					isLoading={testRecipe.isPending}
					onClick={() => recipe && testRecipe.mutate({ recipe })}
				>
					<Play className='size-3.5' />
					Test recipe
				</Button>
			}
		>
			{validationErrors.length > 0 && <ErrorMessage message={validationErrors.join('\n')} />}
			{testRecipe.error && <ErrorMessage message={testRecipe.error.message} />}

			{result && (
				<div className='flex flex-col gap-4'>
					<div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
						<Stat label='Pages' value={`${result.stats.pagesFetched}/${result.stats.pagesDiscovered}`} />
						<Stat label='Requests' value={String(result.stats.requests)} />
						<Stat label='Items' value={String(result.stats.itemsExtracted)} />
						<Stat label='Products' value={String(result.products.length)} />
					</div>

					{(result.stats.failedRequests > 0 || result.stats.extractionErrors > 0) && (
						<div className='flex flex-wrap gap-2'>
							<Badge variant='destructive'>{result.stats.failedRequests} failed requests</Badge>
							<Badge variant='destructive'>{result.stats.extractionErrors} extraction errors</Badge>
						</div>
					)}

					{errorEvents.length > 0 && (
						<div className='rounded-md border border-destructive/30 bg-destructive/5 p-3'>
							<div className='mb-2 text-xs font-medium text-destructive'>Errors</div>
							<div className='grid gap-1 text-xs text-muted-foreground'>
								{errorEvents.slice(0, 10).map((event, index) => (
									<div key={`${event.url ?? 'error'}-${index}`} className='truncate'>
										{event.url ? `${event.url}: ` : ''}
										{event.message}
									</div>
								))}
							</div>
						</div>
					)}

					{result.products.length === 0 ? (
						<Empty>No products were extracted.</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Product key</TableHead>
									<TableHead>Name</TableHead>
									<TableHead>SKU</TableHead>
									<TableHead>URL</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{result.products.slice(0, 10).map((product) => (
									<TableRow key={String(product.product_key)}>
										<TableCell className='max-w-44 truncate font-mono text-xs'>
											{String(product.product_key)}
										</TableCell>
										<TableCell className='max-w-56 truncate'>
											{String(product.name ?? '—')}
										</TableCell>
										<TableCell className='max-w-36 truncate'>
											{String(product.sku ?? '—')}
										</TableCell>
										<TableCell className='max-w-72 truncate text-muted-foreground'>
											{String(product.canonical_url ?? product.source_url ?? '—')}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}

					<details className='rounded-md border bg-muted/20 p-3 text-xs'>
						<summary className='cursor-pointer font-medium'>Raw dry-run result</summary>
						<pre className='mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all'>
							{JSON.stringify({ stats: result.stats, products: result.products.slice(0, 10) }, null, 2)}
						</pre>
					</details>
				</div>
			)}
		</SettingsCard>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className='rounded-md border bg-muted/20 p-3'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className='mt-1 text-lg font-semibold'>{value}</div>
		</div>
	);
}
