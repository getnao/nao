import { useEffect, useState } from 'react';
import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Globe, Image as ImageIcon, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import type { StoryTheme } from '@nao/shared/story-theme';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { Switch } from '@/components/ui/switch';
import { StoryThemePreview } from '@/components/settings/story-theme-preview';
import { requireAdmin } from '@/lib/require-admin';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/story-design')({
	beforeLoad: requireAdmin,
	component: StoryDesignPage,
});

/**
 * Admin screen for the story design system (issue #1463).
 *
 * The flow is deliberately three steps rather than one: point nao at a site,
 * look at what it proposes, then publish. Inference writes a draft and nothing
 * else, so nobody's stories change shape because an admin pasted a URL to see
 * what would happen.
 */
function StoryDesignPage() {
	const queryClient = useQueryClient();
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const state = useQuery(trpc.storyTheme.getState.queryOptions());

	const [url, setUrl] = useState('');
	const [draft, setDraft] = useState<StoryTheme | null>(null);
	const [notes, setNotes] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	// Shown once a site refuses us: the admin captures the design system in their
	// own browser instead, where their company's bot protection is not in play.
	const [showCapture, setShowCapture] = useState(false);
	const [shot, setShot] = useState<{ name: string; preview: string } | null>(null);

	useEffect(() => {
		if (state.data) {
			setDraft(state.data.draft ?? null);
			setNotes(state.data.notes ?? []);
			setUrl((current) => current || (state.data.source ?? ''));
		}
	}, [state.data]);

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: trpc.storyTheme.getState.queryKey() });
		await queryClient.invalidateQueries({ queryKey: trpc.storyTheme.getActive.queryKey() });
	};

	const infer = useMutation({
		...trpc.storyTheme.inferFromUrl.mutationOptions(),
		onSuccess: async (result) => {
			setError(null);
			setDraft(result.theme as StoryTheme);
			setNotes(result.notes);
			await invalidate();
		},
		onError: (err) => {
			setError(err.message);
			if (/403|bot protection|refused an automated request|render the page/i.test(err.message)) {
				setShowCapture(true);
			}
		},
	});

	const inferFromImage = useMutation({
		...trpc.storyTheme.inferFromImage.mutationOptions(),
		onSuccess: async (result) => {
			setError(null);
			setShowCapture(false);
			setShot(null);
			setDraft(result.theme as StoryTheme);
			setNotes(result.notes);
			await invalidate();
		},
		onError: (err) => setError(err.message),
	});

	const handleScreenshot = (file: File) => {
		setError(null);
		if (file.size > 6_000_000) {
			setError(`That image is ${Math.round(file.size / 1_000_000)}MB. Keep it under 6MB.`);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const dataUrl = String(reader.result);
			setShot({ name: file.name, preview: dataUrl });
			if (!project.data?.id) {
				return;
			}
			inferFromImage.mutate({
				projectId: project.data.id,
				hint: url.trim() || undefined,
				mediaType: (file.type as 'image/png' | 'image/jpeg' | 'image/webp') || 'image/png',
				data: dataUrl.slice(dataUrl.indexOf(',') + 1),
			});
		};
		reader.readAsDataURL(file);
	};

	const publish = useMutation({
		...trpc.storyTheme.publish.mutationOptions(),
		onSuccess: async () => {
			setError(null);
			await invalidate();
		},
		onError: (err) => setError(err.message),
	});

	const setEnabled = useMutation({
		...trpc.storyTheme.setEnabled.mutationOptions(),
		onSuccess: invalidate,
	});

	const reset = useMutation({
		...trpc.storyTheme.reset.mutationOptions(),
		onSuccess: async () => {
			setDraft(null);
			setNotes([]);
			setUrl('');
			await invalidate();
		},
	});

	const published = (state.data?.published as StoryTheme | null) ?? null;
	const shown = draft ?? published ?? DEFAULT_STORY_THEME;
	const hasDraft = Boolean(draft);

	return (
		<SettingsPageWrapper>
			<SettingsCard
				titleSize='lg'
				title='Story design system'
				description='Point nao at your website and it proposes a template for every story in this workspace: layout, typography, filters and chart colours. You review it before anything changes.'
			>
				<div className='px-4 flex flex-col gap-4'>
					<div className='flex flex-col gap-2'>
						<label htmlFor='design-url' className='text-sm font-medium'>
							Company website
						</label>
						<div className='flex gap-2'>
							<div className='relative flex-1'>
								<Globe className='absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground' />
								<Input
									id='design-url'
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder='https://www.example.com'
									className='pl-9'
									disabled={infer.isPending}
								/>
							</div>
							<Button
								onClick={() => {
									if (!project.data?.id) {
										return;
									}
									infer.mutate({ projectId: project.data.id, url: url.trim() });
								}}
								disabled={!url.trim() || infer.isPending || !project.data?.id}
							>
								{infer.isPending ? (
									<>
										<Loader2 className='size-4 animate-spin' /> Reading the site
									</>
								) : (
									<>
										<Sparkles className='size-4' /> Infer design system
									</>
								)}
							</Button>
						</div>
						<p className='text-xs text-muted-foreground'>
							nao reads the public stylesheets on that page. Fonts your brand self-hosts under a
							commercial licence are not copied: the closest available fallback is used and named below.
						</p>
					</div>

					{error && (
						<div className='flex items-start gap-2 text-sm text-destructive'>
							<AlertTriangle className='size-4 mt-0.5 shrink-0' />
							<span>{error}</span>
						</div>
					)}

					{!showCapture && (
						<button
							type='button'
							onClick={() => setShowCapture(true)}
							className='self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'
						>
							Site blocked, behind SSO, or internal? Use a screenshot instead
						</button>
					)}

					{showCapture && (
						<div className='flex flex-col gap-3 rounded-lg border p-4'>
							<div>
								<p className='text-sm font-medium'>Use a screenshot instead</p>
								<p className='mt-1 text-xs text-muted-foreground'>
									For sites behind bot protection or single sign-on, and for internal or staging sites
									nao cannot reach. Drop in a screenshot of your homepage and nao reads the design
									system from the image. Less precise than reading the live page: radii, font names
									and any colour not visible on screen are approximations.
								</p>
							</div>

							<label className='flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center hover:bg-muted/30'>
								<ImageIcon className='size-5 text-muted-foreground' />
								<span className='text-sm'>
									{shot ? shot.name : 'Choose a screenshot, or drop one here'}
								</span>
								<span className='text-xs text-muted-foreground'>PNG, JPEG or WebP, up to 6MB</span>
								<input
									type='file'
									accept='image/png,image/jpeg,image/webp'
									className='hidden'
									onChange={(e) => {
										const file = e.target.files?.[0];
										if (file) {
											handleScreenshot(file);
										}
									}}
								/>
							</label>

							{shot && (
								<img
									src={shot.preview}
									alt='Screenshot being read'
									className='max-h-40 w-full rounded-md border object-cover object-top'
								/>
							)}

							<div className='flex items-center gap-2'>
								{inferFromImage.isPending && (
									<span className='flex items-center gap-2 text-xs text-muted-foreground'>
										<Loader2 className='size-3.5 animate-spin' /> Reading the screenshot
									</span>
								)}
								<Button
									variant='ghost'
									size='sm'
									className='ml-auto'
									onClick={() => setShowCapture(false)}
								>
									Cancel
								</Button>
							</div>
						</div>
					)}
				</div>
			</SettingsCard>

			<SettingsCard
				title='Proposed template'
				description={
					hasDraft
						? 'This is a draft. Nothing changes for your users until you publish it.'
						: published
							? 'The template currently applied to every story in this workspace.'
							: 'No template yet. Stories use the nao default.'
				}
				action={
					hasDraft ? (
						<Badge variant='secondary'>Awaiting review</Badge>
					) : published ? (
						<Badge>Published</Badge>
					) : null
				}
			>
				<div className='px-4 flex flex-col gap-5'>
					<StoryThemePreview theme={shown} />

					{notes.length > 0 && (
						<div className='rounded-md border border-border p-3 flex flex-col gap-1.5'>
							<p className='text-xs font-medium'>What nao adjusted</p>
							<ul className='text-xs text-muted-foreground list-disc pl-4 space-y-1'>
								{notes.map((note) => (
									<li key={note}>{note}</li>
								))}
							</ul>
							<p className='text-xs text-muted-foreground pt-1'>
								Brand palettes are built for marketing, not for encoding data. Chart colours are checked
								for contrast and colour-vision separation, and repaired hue-first when they fail.
							</p>
						</div>
					)}

					<div className='flex flex-wrap items-center gap-2'>
						<Button
							onClick={() => publish.mutate({ theme: shown })}
							disabled={!hasDraft || publish.isPending}
						>
							{publish.isPending ? (
								<Loader2 className='size-4 animate-spin' />
							) : (
								<Check className='size-4' />
							)}
							Publish to all stories
						</Button>
						<Button
							variant='ghost'
							onClick={() => reset.mutate()}
							disabled={reset.isPending || (!published && !hasDraft)}
						>
							<RotateCcw className='size-4' />
							Reset to nao default
						</Button>
					</div>
				</div>
			</SettingsCard>

			<SettingsCard
				title='Apply to stories'
				description='Turn the published template on or off without losing it.'
			>
				<div className='px-4 flex items-center justify-between gap-4'>
					<div className='text-sm text-muted-foreground'>
						{published
							? 'Applies to classic and custom stories, including newly generated ones.'
							: 'Publish a template first.'}
					</div>
					<Switch
						checked={state.data?.enabled ?? false}
						disabled={!published || setEnabled.isPending}
						onCheckedChange={(checked) => setEnabled.mutate({ enabled: checked })}
					/>
				</div>
			</SettingsCard>
		</SettingsPageWrapper>
	);
}
