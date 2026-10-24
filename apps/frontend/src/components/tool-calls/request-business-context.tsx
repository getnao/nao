import { useMutation } from '@tanstack/react-query';
import { BookOpenText } from 'lucide-react';
import { useRef, useState } from 'react';

import {
	ConfluenceContextSetup,
	getConfluenceContextFingerprint,
	parseConfluencePages,
} from './confluence-context-setup';
import { FileContextSetup } from './file-context-setup';
import { GithubContextSetup } from './github-context-setup';
import { getNotionContextFingerprint, NotionContextSetup, parseNotionPages } from './notion-context-setup';
import type { ConfluenceContextValues } from './confluence-context-setup';
import type { GithubContextValues } from './github-context-setup';
import type { NotionContextValues } from './notion-context-setup';
import type { TabBarItem } from '@/components/ui/tab-bar';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TabBar, TabPanel } from '@/components/ui/tab-bar';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/main';

type SelectedContextSources = {
	notion?: { apiKey: string; pages: string[] };
	confluence?: { baseUrl: string; email: string; apiToken: string; pages: string[] };
	github?: GithubContextValues;
};

type BusinessContextTab = 'about' | 'sources';

export function RequestBusinessContext({ jobId }: { jobId: string }) {
	const [open, setOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<BusinessContextTab>('about');
	const [website, setWebsite] = useState('');
	const [businessDescription, setBusinessDescription] = useState('');
	const [notionValues, setNotionValues] = useState<NotionContextValues>({ apiKey: '', pagesText: '' });
	const [validatedNotionFingerprint, setValidatedNotionFingerprint] = useState<string | null>(null);
	const [validatedNotionPages, setValidatedNotionPages] = useState<Array<{ url: string; title: string }>>([]);
	const [confluenceValues, setConfluenceValues] = useState<ConfluenceContextValues>({
		baseUrl: '',
		email: '',
		apiToken: '',
		pagesText: '',
	});
	const [validatedConfluenceFingerprint, setValidatedConfluenceFingerprint] = useState<string | null>(null);
	const [validatedConfluencePages, setValidatedConfluencePages] = useState<Array<{ url: string; title: string }>>([]);
	const [githubValues, setGithubValues] = useState<GithubContextValues>({ repoFullName: '', branch: '' });
	const [files, setFiles] = useState<File[]>([]);
	const [isUploadingFiles, setIsUploadingFiles] = useState(false);
	const [fileUploadError, setFileUploadError] = useState<string | null>(null);
	const preparedFiles = useRef<File[] | null>(null);
	const validateNotion = useMutation(trpc.onboarding.validateNotionContext.mutationOptions());
	const validateConfluence = useMutation(trpc.onboarding.validateConfluenceContext.mutationOptions());
	const submitContext = useMutation(
		trpc.onboarding.submitWarehouseContextSources.mutationOptions({
			onSuccess: () => setOpen(false),
		}),
	);

	const notionConnected =
		validatedNotionFingerprint !== null && validatedNotionFingerprint === getNotionContextFingerprint(notionValues);
	const confluenceConnected =
		validatedConfluenceFingerprint !== null &&
		validatedConfluenceFingerprint === getConfluenceContextFingerprint(confluenceValues);
	const githubConnected = githubValues.repoFullName.length > 0 && githubValues.branch.length > 0;
	const selectedContextSources: SelectedContextSources = {
		...(notionConnected && {
			notion: { apiKey: notionValues.apiKey.trim(), pages: parseNotionPages(notionValues.pagesText) },
		}),
		...(confluenceConnected && {
			confluence: {
				baseUrl: confluenceValues.baseUrl.trim(),
				email: confluenceValues.email.trim(),
				apiToken: confluenceValues.apiToken.trim(),
				pages: parseConfluencePages(confluenceValues.pagesText),
			},
		}),
		...(githubConnected && { github: githubValues }),
	};
	const normalizedWebsite = normalizeWebsiteUrl(website);
	const additionalContext = [
		normalizedWebsite && `Website: ${normalizedWebsite}`,
		businessDescription.trim() && `About the business: ${businessDescription.trim()}`,
	]
		.filter(Boolean)
		.join('\n\n');
	const businessContext = additionalContext ? { additionalContext } : {};
	const hasConnectedContext =
		additionalContext.length > 0 || notionConnected || confluenceConnected || githubConnected || files.length > 0;
	const isStarting = submitContext.isPending || isUploadingFiles;
	const submit = async (
		contextSources: SelectedContextSources,
		selectedBusinessContext: { additionalContext?: string } = businessContext,
		filesToUpload = files,
	) => {
		submitContext.reset();
		setFileUploadError(null);
		setIsUploadingFiles(true);
		try {
			if (!areSameFiles(preparedFiles.current, filesToUpload)) {
				preparedFiles.current = null;
				await clearWarehouseContextFiles(jobId);
				for (const file of filesToUpload) {
					await uploadWarehouseContextFile(jobId, file);
				}
				preparedFiles.current = [...filesToUpload];
			}
		} catch (error) {
			setFileUploadError(error instanceof Error ? error.message : 'File upload failed.');
			setIsUploadingFiles(false);
			return;
		}

		await submitContext
			.mutateAsync({ jobId, contextSources, businessContext: selectedBusinessContext })
			.catch(() => undefined);
		setIsUploadingFiles(false);
	};
	const tabs: TabBarItem<BusinessContextTab>[] = [
		{ id: 'about', label: 'About your business' },
		{ id: 'sources', label: 'Sources' },
	];

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<div className='animate-fade-in-up flex flex-col items-start justify-between gap-4 rounded-xl border border-violet/20 bg-background p-5 shadow-xs sm:flex-row sm:items-center'>
				<div className='flex min-w-0 items-center gap-3'>
					<div className='flex size-10 shrink-0 items-center justify-center rounded-lg border border-violet/20 bg-violet/10 text-primary'>
						<BookOpenText className='size-5' />
					</div>
					<div className='min-w-0'>
						<div className='font-borna text-lg font-medium tracking-tight text-foreground'>
							Business context
						</div>
						<p className='text-xs text-muted-foreground'>
							Connect documentation or a repository before syncing.
						</p>
					</div>
				</div>
				<div className='relative w-full shrink-0 sm:w-auto'>
					<DialogTrigger asChild>
						<Button className='w-full rounded-full sm:w-auto'>Add business context</Button>
					</DialogTrigger>
					<Button
						type='button'
						variant='ghost'
						size='sm'
						className='absolute left-1/2 top-full mt-1 h-auto -translate-x-1/2 py-0 text-xs text-muted-foreground/60 hover:bg-transparent hover:text-muted-foreground'
						disabled={isStarting}
						onClick={() => void submit({}, {}, [])}
					>
						Skip
					</Button>
				</div>
			</div>
			<DialogContent
				className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'
				overlayClassName='data-[state=open]:animate-none data-[state=closed]:animate-none'
			>
				<DialogHeader className='pr-8'>
					<div className='flex items-start gap-3 text-left'>
						<div className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet'>
							<BookOpenText className='size-5' />
						</div>
						<div className='space-y-1'>
							<DialogTitle>Add business context</DialogTitle>
							<DialogDescription>
								Optionally connect documentation or a repository before starting sync.
							</DialogDescription>
						</div>
					</div>
				</DialogHeader>
				<TabBar
					tabs={tabs}
					activeTab={activeTab}
					onTabChange={setActiveTab}
					idBase='business-context'
					className='-mx-6 border-b px-6'
				/>
				{activeTab === 'about' ? (
					<TabPanel idBase='business-context' tabId='about'>
						<div className='flex flex-col gap-5'>
							<section className='space-y-4 rounded-xl border bg-muted/20 p-4'>
								<div className='grid gap-2'>
									<label htmlFor='business-website' className='text-sm font-medium'>
										Company website
									</label>
									<Input
										id='business-website'
										type='url'
										value={website}
										onChange={(event) => setWebsite(event.target.value)}
										onBlur={() => setWebsite(normalizeWebsiteUrl(website))}
										placeholder='https://yourcompany.com'
										autoComplete='url'
									/>
									<p className='text-[11px] text-muted-foreground'>
										Paste a website nao can use to understand your company.
									</p>
								</div>
								<div className='grid gap-2'>
									<label htmlFor='business-description' className='text-sm font-medium'>
										Tell us more about your business
									</label>
									<Textarea
										id='business-description'
										value={businessDescription}
										onChange={(event) => setBusinessDescription(event.target.value)}
										placeholder='What does your company do, and what should nao understand about it?'
										rows={5}
									/>
								</div>
							</section>
							<div className='flex items-center justify-between gap-2 border-t pt-4'>
								<Button
									type='button'
									variant='ghost'
									size='sm'
									onClick={() => setOpen(false)}
									disabled={isStarting}
								>
									Close
								</Button>
								<Button
									type='button'
									className='rounded-full'
									size='sm'
									onClick={() => setActiveTab('sources')}
								>
									Next
								</Button>
							</div>
						</div>
					</TabPanel>
				) : (
					<TabPanel idBase='business-context' tabId='sources'>
						<NotionContextSetup
							values={notionValues}
							validatedFingerprint={validatedNotionFingerprint}
							validatedPages={validatedNotionPages}
							isValidating={validateNotion.isPending}
							isContextValidating={validateNotion.isPending || validateConfluence.isPending}
							isStarting={isStarting}
							canStart
							hasConnectedContext={hasConnectedContext}
							additionalProviders={
								<>
									<ConfluenceContextSetup
										values={confluenceValues}
										validatedFingerprint={validatedConfluenceFingerprint}
										validatedPages={validatedConfluencePages}
										isValidating={validateConfluence.isPending}
										isStarting={isStarting}
										error={validateConfluence.error}
										onValuesChange={setConfluenceValues}
										onValidatedFingerprintChange={setValidatedConfluenceFingerprint}
										onValidate={async (values) => {
											const result = await validateConfluence.mutateAsync({
												baseUrl: values.baseUrl.trim(),
												email: values.email.trim(),
												apiToken: values.apiToken.trim(),
												pages: parseConfluencePages(values.pagesText),
											});
											setValidatedConfluencePages(result.pages);
										}}
									/>
									<GithubContextSetup
										values={githubValues}
										isStarting={isStarting}
										onValuesChange={setGithubValues}
									/>
									<FileContextSetup
										files={files}
										disabled={isStarting}
										error={fileUploadError}
										onFilesChange={setFiles}
									/>
								</>
							}
							error={validateNotion.error}
							submissionError={submitContext.error}
							onValuesChange={setNotionValues}
							onValidatedFingerprintChange={setValidatedNotionFingerprint}
							onValidate={async (values) => {
								const result = await validateNotion.mutateAsync({
									apiKey: values.apiKey.trim(),
									pages: parseNotionPages(values.pagesText),
								});
								setValidatedNotionPages(result.pages);
							}}
							onBack={() => setActiveTab('about')}
							backLabel='Previous'
							onSkip={() => void submit({})}
							onSubmit={() => void submit(selectedContextSources)}
						/>
					</TabPanel>
				)}
			</DialogContent>
		</Dialog>
	);
}

function areSameFiles(preparedFiles: File[] | null, selectedFiles: File[]): boolean {
	return (
		preparedFiles !== null &&
		preparedFiles.length === selectedFiles.length &&
		preparedFiles.every((file, index) => file === selectedFiles[index])
	);
}

async function clearWarehouseContextFiles(jobId: string): Promise<void> {
	const response = await fetch(`/api/onboarding/context-files?jobId=${encodeURIComponent(jobId)}`, {
		method: 'DELETE',
	});
	if (response.ok) {
		return;
	}

	const body = (await response.json().catch(() => null)) as { error?: string } | null;
	throw new Error(body?.error ?? 'Could not update the selected business context files.');
}

async function uploadWarehouseContextFile(jobId: string, file: File): Promise<void> {
	const formData = new FormData();
	formData.append('file', file);
	const response = await fetch(`/api/onboarding/context-files?jobId=${encodeURIComponent(jobId)}`, {
		method: 'POST',
		body: formData,
	});
	if (response.ok) {
		return;
	}

	const body = (await response.json().catch(() => null)) as { error?: string } | null;
	throw new Error(body?.error ?? `Could not upload ${file.name}.`);
}

function normalizeWebsiteUrl(value: string): string {
	const website = value.trim();
	return website && !/^https:\/\//i.test(website) ? `https://${website.replace(/^http:\/\//i, '')}` : website;
}
