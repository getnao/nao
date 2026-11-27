import { CircleCheck } from 'lucide-react';
import { useState } from 'react';

import ConfluenceIcon from '@/components/icons/confluence.svg';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-fields';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface ConfluenceContextValues {
	baseUrl: string;
	email: string;
	apiToken: string;
	pagesText: string;
}

interface ConfluenceContextSetupProps {
	values: ConfluenceContextValues;
	validatedFingerprint: string | null;
	validatedPages: Array<{ url: string; title: string }>;
	isValidating: boolean;
	isStarting: boolean;
	error: { message: string } | null;
	onValuesChange: (values: ConfluenceContextValues) => void;
	onValidatedFingerprintChange: (fingerprint: string) => void;
	onValidate: (values: ConfluenceContextValues) => Promise<void>;
}

export function ConfluenceContextSetup({
	values,
	validatedFingerprint,
	validatedPages,
	isValidating,
	isStarting,
	error,
	onValuesChange,
	onValidatedFingerprintChange,
	onValidate,
}: ConfluenceContextSetupProps) {
	const [expanded, setExpanded] = useState(
		Boolean(values.baseUrl || values.email || values.apiToken || values.pagesText),
	);
	const fingerprint = getConfluenceContextFingerprint(values);
	const connected = validatedFingerprint !== null && validatedFingerprint === fingerprint;
	const pages = parseConfluencePages(values.pagesText);
	const canValidate =
		isConfluenceCloudUrl(values.baseUrl) &&
		values.email.trim().length > 0 &&
		values.apiToken.trim().length > 0 &&
		pages.length > 0;

	const validate = async () => {
		await onValidate(values);
		onValidatedFingerprintChange(fingerprint);
	};

	return (
		<section className='space-y-4 rounded-xl border bg-muted/20 p-4'>
			<div className='flex items-center gap-3'>
				<div className='flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background shadow-xs'>
					<ConfluenceIcon className='size-5 text-[#1868DB]' aria-hidden />
				</div>
				<div className='min-w-0 flex-1'>
					<div className='flex items-center gap-2'>
						<h3 className='text-sm font-medium'>Confluence</h3>
						<Badge variant='secondary' className='h-5 px-1.5 text-[10px] font-normal'>
							Optional
						</Badge>
					</div>
					<p className='text-xs text-muted-foreground'>Sync Confluence Cloud pages as business context.</p>
				</div>
				<Button
					type='button'
					variant='outline'
					size='sm'
					aria-expanded={expanded}
					onClick={() => setExpanded((current) => !current)}
				>
					{expanded ? 'Hide' : connected ? 'Edit' : 'Connect'}
				</Button>
			</div>

			{expanded && (
				<div className='space-y-4 border-t pt-4'>
					<div className='grid gap-4 sm:grid-cols-2'>
						<div className='grid gap-2 sm:col-span-2'>
							<label htmlFor='confluence-base-url' className='text-sm font-medium'>
								Confluence site URL
							</label>
							<Input
								id='confluence-base-url'
								value={values.baseUrl}
								onChange={(event) => onValuesChange({ ...values, baseUrl: event.target.value })}
								placeholder='https://acme.atlassian.net/wiki'
								autoComplete='url'
							/>
							{values.baseUrl.trim() && !isConfluenceCloudUrl(values.baseUrl) && (
								<p className='text-xs text-destructive'>
									Enter a Confluence Cloud URL such as https://acme.atlassian.net/wiki.
								</p>
							)}
						</div>
						<div className='grid gap-2'>
							<label htmlFor='confluence-email' className='text-sm font-medium'>
								Account email
							</label>
							<Input
								id='confluence-email'
								type='email'
								value={values.email}
								onChange={(event) => onValuesChange({ ...values, email: event.target.value })}
								placeholder='you@company.com'
								autoComplete='email'
							/>
						</div>
						<div className='grid gap-2'>
							<label htmlFor='confluence-api-token' className='text-sm font-medium'>
								API token
							</label>
							<Input
								id='confluence-api-token'
								type='password'
								value={values.apiToken}
								onChange={(event) => onValuesChange({ ...values, apiToken: event.target.value })}
								placeholder='Enter your Atlassian API token'
								autoComplete='off'
							/>
						</div>
						<div className='grid gap-2 sm:col-span-2'>
							<label htmlFor='confluence-pages' className='text-sm font-medium'>
								Page URLs or IDs
							</label>
							<Textarea
								id='confluence-pages'
								value={values.pagesText}
								onChange={(event) => onValuesChange({ ...values, pagesText: event.target.value })}
								placeholder={'https://acme.atlassian.net/wiki/spaces/ENG/pages/123456/Page\n789012'}
								rows={4}
							/>
							<p className='text-[11px] text-muted-foreground'>
								Enter one page URL or numeric page ID per line.
							</p>
						</div>
					</div>

					{error && <FormError error={error.message} />}

					<div className='flex items-center justify-between gap-3'>
						{connected ? (
							<div className='flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400'>
								<CircleCheck className='size-4' />
								<span>
									Confluence connected · {validatedPages.length}{' '}
									{validatedPages.length === 1 ? 'page' : 'pages'}
								</span>
							</div>
						) : (
							<span className='text-xs text-muted-foreground'>
								{pages.length} {pages.length === 1 ? 'page' : 'pages'} to validate
							</span>
						)}
						<Button
							type='button'
							size='sm'
							className='rounded-full'
							onClick={validate}
							disabled={!canValidate || isValidating || isStarting}
							isLoading={isValidating}
						>
							{isValidating ? 'Connecting…' : connected ? 'Reconnect' : 'Connect Confluence'}
						</Button>
					</div>
				</div>
			)}
		</section>
	);
}

export function parseConfluencePages(value: string): string[] {
	return [
		...new Set(
			value
				.split(/\r?\n/)
				.map((page) => page.trim())
				.filter(Boolean),
		),
	];
}

export function getConfluenceContextFingerprint(values: ConfluenceContextValues): string {
	return JSON.stringify({
		baseUrl: values.baseUrl.trim(),
		email: values.email.trim(),
		apiToken: values.apiToken.trim(),
		pages: parseConfluencePages(values.pagesText),
	});
}

function isConfluenceCloudUrl(value: string): boolean {
	try {
		const url = new URL(value.trim());
		return url.protocol === 'https:' && url.hostname.endsWith('.atlassian.net') && !url.search && !url.hash;
	} catch {
		return false;
	}
}
