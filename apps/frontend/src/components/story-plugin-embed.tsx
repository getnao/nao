import { memo, useEffect, useRef, useState } from 'react';
import type { ParsedPluginBlock } from '@nao/shared/story-segments';

type PluginCleanup = void | (() => void);
type PluginStatus = { state: 'loading' | 'ready' } | { state: 'error'; message: string };

interface PluginModule {
	default: (element: HTMLElement) => PluginCleanup | Promise<PluginCleanup>;
}

export const StoryPluginEmbed = memo(function StoryPluginEmbed({ plugin }: { plugin: ParsedPluginBlock }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<PluginStatus>({ state: 'loading' });

	useEffect(() => {
		const element = containerRef.current;
		if (!element) {
			return;
		}

		let disposed = false;
		let cleanup: PluginCleanup;
		const moduleUrl = URL.createObjectURL(new Blob([plugin.code], { type: 'text/javascript' }));

		element.replaceChildren();
		setStatus({ state: 'loading' });
		void import(/* @vite-ignore */ moduleUrl)
			.then((loaded: unknown) => {
				if (!isPluginModule(loaded)) {
					throw new Error('The module must export a default render(element) function.');
				}
				return loaded.default(element);
			})
			.then((nextCleanup) => {
				if (disposed) {
					nextCleanup?.();
					return;
				}
				cleanup = nextCleanup;
				setStatus({ state: 'ready' });
			})
			.catch((error: unknown) => {
				if (!disposed) {
					element.replaceChildren();
					setStatus({ state: 'error', message: toErrorMessage(error) });
				}
			});

		return () => {
			disposed = true;
			cleanup?.();
			element.replaceChildren();
			URL.revokeObjectURL(moduleUrl);
		};
	}, [plugin.code]);

	return (
		<div className='my-2 overflow-hidden rounded-lg border bg-card'>
			{plugin.title ? (
				<div className='border-b px-4 py-3 text-sm font-medium text-foreground'>{plugin.title}</div>
			) : null}
			<div className='relative min-h-64'>
				<div ref={containerRef} className='min-h-64 w-full' />
				{status.state !== 'ready' ? (
					<div className='absolute inset-0 flex min-h-64 items-center justify-center bg-card p-4 text-center text-sm text-muted-foreground'>
						{status.state === 'error' ? `Could not render plugin: ${status.message}` : 'Loading plugin...'}
					</div>
				) : null}
			</div>
		</div>
	);
});

function isPluginModule(value: unknown): value is PluginModule {
	return (
		typeof value === 'object' && value !== null && typeof (value as { default?: unknown }).default === 'function'
	);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
