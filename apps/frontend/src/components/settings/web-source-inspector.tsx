import { useMutation } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { WebRobotRecipe } from '@nao/shared/web-robot';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { Textarea } from '@/components/ui/textarea';
import { parseBrowserActions, parseBrowserCaptures } from '@/components/settings/web-source-recipe';
import { trpc } from '@/main';

export function WebSourceInspector({ recipe }: { recipe?: WebRobotRecipe }) {
	const firstSourceUrl = recipe?.stages[0]?.source.url ?? '';
	const [url, setUrl] = useState(firstSourceUrl);
	const [loader, setLoader] = useState<'http' | 'browser'>(
		firstSourceUrl && recipe?.stages[0]?.source.type === 'browser' ? 'browser' : 'http',
	);
	const [selectorsText, setSelectorsText] = useState('');
	const [actionsText, setActionsText] = useState('[]');
	const [capturesText, setCapturesText] = useState('[]');
	const inspect = useMutation(trpc.webRobot.inspectUrl.mutationOptions());

	const parseErrors = useMemo(() => {
		const actions = parseBrowserActions(actionsText);
		const captures = parseBrowserCaptures(capturesText);
		return [...actions.errors, ...captures.errors];
	}, [actionsText, capturesText]);

	const handleInspect = () => {
		const actions = parseBrowserActions(actionsText);
		const captures = parseBrowserCaptures(capturesText);
		if (!url.trim() || actions.errors.length > 0 || captures.errors.length > 0) {
			return;
		}
		inspect.mutate({
			url: url.trim(),
			loader,
			allowedHosts: recipe?.allowedHosts,
			selectors: selectorsText
				.split('\n')
				.map((selector) => selector.trim())
				.filter(Boolean),
			actions: loader === 'browser' ? (actions.actions ?? []) : [],
			capture: loader === 'browser' ? (captures.captures ?? []) : [],
		});
	};

	const result = inspect.data;

	return (
		<SettingsCard
			title='Inspect URL'
			description='Check selectors, browser actions, and captured responses against one page before running the recipe.'
			action={
				<Button
					type='button'
					variant='secondary'
					size='sm'
					disabled={!url.trim() || inspect.isPending || parseErrors.length > 0}
					isLoading={inspect.isPending}
					onClick={handleInspect}
				>
					<Search className='size-3.5' />
					Inspect
				</Button>
			}
		>
			<div className='grid gap-3 md:grid-cols-[1fr_10rem]'>
				<label className='grid gap-1.5 text-sm'>
					<span className='text-xs font-medium text-muted-foreground'>URL</span>
					<Input
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder='https://example.com'
					/>
				</label>
				<label className='grid gap-1.5 text-sm'>
					<span className='text-xs font-medium text-muted-foreground'>Loader</span>
					<Select value={loader} onValueChange={(value) => setLoader(value as 'http' | 'browser')}>
						<SelectTrigger size='input'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value='http'>HTTP</SelectItem>
							<SelectItem value='browser'>Browser</SelectItem>
						</SelectContent>
					</Select>
				</label>
			</div>

			<label className='grid gap-1.5 text-sm'>
				<span className='text-xs font-medium text-muted-foreground'>Selectors, one per line</span>
				<Textarea
					value={selectorsText}
					onChange={(event) => setSelectorsText(event.target.value)}
					placeholder={'a.product-card\n.product-title'}
					className='min-h-20 font-mono text-xs'
				/>
			</label>

			{loader === 'browser' && (
				<div className='grid gap-3 lg:grid-cols-2'>
					<label className='grid gap-1.5 text-sm'>
						<span className='text-xs font-medium text-muted-foreground'>Browser actions JSON</span>
						<Textarea
							value={actionsText}
							onChange={(event) => setActionsText(event.target.value)}
							className='min-h-28 font-mono text-xs'
						/>
					</label>
					<label className='grid gap-1.5 text-sm'>
						<span className='text-xs font-medium text-muted-foreground'>Network captures JSON</span>
						<Textarea
							value={capturesText}
							onChange={(event) => setCapturesText(event.target.value)}
							className='min-h-28 font-mono text-xs'
						/>
					</label>
				</div>
			)}

			{parseErrors.length > 0 && <ErrorMessage message={parseErrors.join('\n')} />}
			{inspect.error && <ErrorMessage message={inspect.error.message} />}

			{result && (
				<div className='flex flex-col gap-4'>
					<div className='grid gap-2 sm:grid-cols-3'>
						<InspectStat label='Status' value={String(result.status)} />
						<InspectStat label='Title' value={result.title ?? '—'} />
						<InspectStat label='Captures' value={String(result.captures.length)} />
					</div>
					<div className='grid gap-1 text-xs text-muted-foreground'>
						<div className='truncate'>Requested: {result.url}</div>
						<div className='truncate'>Final: {result.finalUrl}</div>
					</div>

					{Object.keys(result.matches).length === 0 ? (
						<Empty>No selectors were checked.</Empty>
					) : (
						<div className='grid gap-2'>
							{Object.entries(result.matches).map(([selector, count]) => (
								<div
									key={selector}
									className='flex items-center justify-between gap-3 rounded-md border p-2'
								>
									<code className='min-w-0 truncate text-xs'>{selector}</code>
									<Badge variant={count > 0 ? 'success' : count === 0 ? 'outline' : 'destructive'}>
										{count < 0 ? 'invalid' : `${count} matches`}
									</Badge>
								</div>
							))}
						</div>
					)}

					{result.captures.length > 0 && (
						<div className='grid gap-2'>
							<div className='text-xs font-medium text-muted-foreground'>Captured responses</div>
							{result.captures.map((capture) => (
								<details
									key={`${capture.name}-${capture.url}`}
									className='rounded-md border p-2 text-xs'
								>
									<summary className='flex cursor-pointer items-center gap-2'>
										<Badge variant='secondary'>{capture.name}</Badge>
										<span className='min-w-0 flex-1 truncate'>{capture.url}</span>
										<span className='text-muted-foreground'>{capture.status}</span>
									</summary>
									<div className='mt-2 grid gap-1 text-muted-foreground'>
										<div>{capture.contentType ?? 'unknown content type'}</div>
										<pre className='max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2'>
											{previewJson(capture.body)}
										</pre>
									</div>
								</details>
							))}
						</div>
					)}

					{result.htmlPreview && (
						<details className='rounded-md border bg-muted/20 p-3 text-xs'>
							<summary className='cursor-pointer font-medium'>HTML preview</summary>
							<pre className='mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all'>
								{result.htmlPreview}
							</pre>
						</details>
					)}
				</div>
			)}
		</SettingsCard>
	);
}

function InspectStat({ label, value }: { label: string; value: string }) {
	return (
		<div className='rounded-md border bg-muted/20 p-3'>
			<div className='text-xs text-muted-foreground'>{label}</div>
			<div className='mt-1 truncate text-sm font-medium'>{value}</div>
		</div>
	);
}

const previewJson = (value: unknown): string => {
	const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	return text.length > 8_000 ? `${text.slice(0, 8_000)}\n…` : text;
};
