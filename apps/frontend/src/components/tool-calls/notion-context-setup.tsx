import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import NotionIcon from '@/components/icons/notion.svg';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-fields';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface NotionContextValues {
	apiKey: string;
	pagesText: string;
}

interface NotionContextSetupProps {
	values: NotionContextValues;
	validatedFingerprint: string | null;
	validatedPages: Array<{ url: string; title: string }>;
	isValidating: boolean;
	isContextValidating?: boolean;
	isStarting: boolean;
	canStart: boolean;
	additionalProviders?: ReactNode;
	hasConnectedContext?: boolean;
	error: { message: string } | null;
	submissionError: { message: string } | null;
	onValuesChange: (values: NotionContextValues) => void;
	onValidatedFingerprintChange: (fingerprint: string) => void;
	onValidate: (values: NotionContextValues) => Promise<void>;
	onBack: () => void;
	backLabel?: string;
	onSkip: () => void;
	onSubmit: () => void;
}

export function NotionContextSetup({
	values,
	validatedFingerprint,
	validatedPages,
	isValidating,
	isContextValidating,
	isStarting,
	canStart,
	additionalProviders,
	hasConnectedContext,
	error,
	submissionError,
	onValuesChange,
	onValidatedFingerprintChange,
	onValidate,
	onBack,
	backLabel = 'Previous',
	onSkip,
	onSubmit,
}: NotionContextSetupProps) {
	const [expanded, setExpanded] = useState(Boolean(values.apiKey || values.pagesText));
	const fingerprint = getNotionContextFingerprint(values);
	const connected = validatedFingerprint !== null && validatedFingerprint === fingerprint;
	const contextConnected = hasConnectedContext ?? connected;
	const contextValidating = isContextValidating ?? isValidating;
	const pages = parseNotionPages(values.pagesText);
	const canValidate = values.apiKey.trim().length > 0 && pages.length > 0;

	const validate = async () => {
		await onValidate({ ...values, apiKey: values.apiKey.trim() });
		onValidatedFingerprintChange(fingerprint);
	};

	return (
		<div className='flex flex-col gap-5'>
			<div className='max-h-[52vh] space-y-3 overflow-y-auto pr-1'>
				<section className='space-y-4 rounded-xl border bg-muted/20 p-4'>
					<div className='flex items-center gap-3'>
						<div className='flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background shadow-xs'>
							<NotionIcon className='size-5' aria-hidden />
						</div>
						<div className='min-w-0 flex-1'>
							<div className='flex items-center gap-2'>
								<h3 className='text-sm font-medium'>Notion</h3>
								<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
									Optional
								</Badge>
							</div>
							<p className='text-xs text-muted-foreground'>
								Sync pages and databases as business context.
							</p>
						</div>
						<Button
							type='button'
							variant='outline'
							size='sm'
							onClick={() => setExpanded((current) => !current)}
						>
							{expanded ? 'Hide' : connected ? 'Edit' : 'Connect'}
						</Button>
					</div>

					{expanded && (
						<div className='space-y-4 border-t pt-4'>
							<div className='grid gap-2'>
								<label htmlFor='notion-integration-token' className='text-sm font-medium'>
									Integration token
								</label>
								<Input
									id='notion-integration-token'
									type='password'
									value={values.apiKey}
									onChange={(event) => onValuesChange({ ...values, apiKey: event.target.value })}
									placeholder='ntn_…'
									autoComplete='off'
								/>
								<p className='text-[11px] text-muted-foreground'>
									Share each page with your Notion integration before connecting.
								</p>
							</div>
							<div className='grid gap-2'>
								<label htmlFor='notion-pages' className='text-sm font-medium'>
									Page or database URLs
								</label>
								<Textarea
									id='notion-pages'
									value={values.pagesText}
									onChange={(event) => onValuesChange({ ...values, pagesText: event.target.value })}
									placeholder={'https://notion.so/your-page\nhttps://notion.so/your-database'}
									rows={4}
								/>
								<p className='text-[11px] text-muted-foreground'>
									Enter one URL or Notion ID per line.
								</p>
							</div>

							{error && <FormError error={error.message} />}

							<div className='flex items-center justify-between gap-3'>
								{connected ? (
									<div className='flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400'>
										<CircleCheck className='size-4' />
										<span>
											Notion connected · {validatedPages.length}{' '}
											{validatedPages.length === 1 ? 'page' : 'pages'}
										</span>
									</div>
								) : (
									<span className='text-xs text-muted-foreground'>
										{pages.length} {pages.length === 1 ? 'item' : 'items'} to validate
									</span>
								)}
								<Button
									type='button'
									size='sm'
									className='rounded-full'
									onClick={() => void validate().catch(() => undefined)}
									disabled={!canValidate || isValidating || isStarting}
									isLoading={isValidating}
								>
									{isValidating ? 'Connecting…' : connected ? 'Reconnect' : 'Connect Notion'}
								</Button>
							</div>
						</div>
					)}
				</section>
				{additionalProviders}
			</div>

			<div className='space-y-2 border-t pt-4'>
				{submissionError && <FormError error={submissionError.message} />}
				{!canStart && (
					<p className='text-xs text-muted-foreground'>Select at least one table before syncing.</p>
				)}
				<div className='flex items-center justify-between gap-2 rounded-full'>
					<Button type='button' variant='ghost' size='sm' onClick={onBack} disabled={isStarting}>
						{backLabel}
					</Button>
					<Button
						type='button'
						size='sm'
						className='rounded-full'
						onClick={contextConnected ? onSubmit : onSkip}
						disabled={!canStart || contextValidating || isStarting}
						isLoading={isStarting}
					>
						{isStarting ? 'Starting sync…' : contextConnected ? 'Sync with context' : 'Skip & sync'}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function parseNotionPages(value: string): string[] {
	return [
		...new Set(
			value
				.split(/\r?\n/)
				.map((page) => page.trim())
				.filter(Boolean),
		),
	];
}

export function getNotionContextFingerprint(values: NotionContextValues): string {
	return JSON.stringify({
		apiKey: values.apiKey.trim(),
		pages: parseNotionPages(values.pagesText),
	});
}
