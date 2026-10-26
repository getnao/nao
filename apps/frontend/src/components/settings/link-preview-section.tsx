import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { BrandingState } from '@/hooks/use-branding';
import { Badge } from '@/components/ui/badge';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsToggleRow } from '@/components/ui/settings-toggle-row';
import { brandingAssetUrl, DEFAULT_BRAND_COLOR, useBranding } from '@/hooks/use-branding';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface LinkPreviewSectionProps {
	isAdmin: boolean;
}

const SAMPLE_BAR_HEIGHTS = [38, 54, 46, 70, 62, 88];
const SAMPLE_STORY_TITLE = 'Q3 revenue review';
const SAMPLE_STORY_DESCRIPTION = 'Story by Jane Doe · Revenue grew 18% quarter over quarter, driven by enterprise…';

export function LinkPreviewSection({ isAdmin }: LinkPreviewSectionProps) {
	const queryClient = useQueryClient();
	const displaySettings = useQuery(trpc.project.getDisplaySettings.queryOptions());
	const updateDisplaySettings = useMutation(
		trpc.project.updateDisplaySettings.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: trpc.project.getDisplaySettings.queryOptions().queryKey,
				});
			},
		}),
	);
	const branding = useBranding();
	const appName = (branding.enabled && branding.appName?.trim()) || 'nao';
	const defaultImageUrl = resolveDefaultImageUrl(branding);
	const isEnabled = displaySettings.data?.linkPreviewThumbnails ?? false;
	const brandColor = branding.brandColor ?? DEFAULT_BRAND_COLOR;

	return (
		<SettingsCard
			title='Link previews'
			description='Story and chat links pasted in Slack, Teams or any other app unfurl with their title, owner and an excerpt.'
		>
			<SettingsToggleRow
				id='link-preview-thumbnails'
				label='Show story thumbnails'
				description='Previews are fetched without signing in, so anyone holding a story link sees its thumbnail, which can show data.'
				checked={isEnabled}
				onCheckedChange={(checked) => updateDisplaySettings.mutate({ linkPreviewThumbnails: checked })}
				disabled={!isAdmin || displaySettings.isLoading || updateDisplaySettings.isPending}
			/>
			<div className='grid gap-3 md:grid-cols-2'>
				<UnfurlPreview label='Enabled' isCurrent={isEnabled} appName={appName}>
					<SampleStoryThumbnail brandColor={brandColor} />
				</UnfurlPreview>
				<UnfurlPreview
					label='Disabled'
					isCurrent={!isEnabled}
					appName={appName}
					sideImageUrl={defaultImageUrl}
				/>
			</div>
		</SettingsCard>
	);
}

interface UnfurlPreviewProps {
	label: string;
	isCurrent: boolean;
	appName: string;
	sideImageUrl?: string | null;
	children?: React.ReactNode;
}

function UnfurlPreview({ label, isCurrent, appName, sideImageUrl, children }: UnfurlPreviewProps) {
	return (
		<div
			className={cn(
				'flex flex-col gap-2 rounded-lg border p-3 transition-colors',
				isCurrent ? 'border-primary/40 bg-primary/5' : 'bg-muted/30',
			)}
		>
			<div className='flex items-center justify-between'>
				<span className='text-xs font-medium text-muted-foreground'>{label}</span>
				{isCurrent && <Badge variant='admin'>Current</Badge>}
			</div>
			<div className='flex gap-3 border-l-4 border-border py-1 pl-3'>
				<div className='flex min-w-0 flex-1 flex-col gap-1'>
					<span className='text-xs font-semibold text-foreground'>{appName}</span>
					<span className='text-sm font-semibold text-blue-600 dark:text-blue-400'>{SAMPLE_STORY_TITLE}</span>
					<span className='text-xs text-muted-foreground'>{SAMPLE_STORY_DESCRIPTION}</span>
					{children}
				</div>
				{sideImageUrl && (
					<img src={sideImageUrl} alt='' className='size-14 shrink-0 rounded-md border object-contain' />
				)}
			</div>
		</div>
	);
}

function SampleStoryThumbnail({ brandColor }: { brandColor: string }) {
	return (
		<div className='mt-1 flex h-24 flex-col gap-2 rounded-md border bg-background p-2.5'>
			<div className='h-1.5 w-1/3 rounded-full bg-muted-foreground/30' />
			<div className='flex flex-1 items-end gap-1.5'>
				{SAMPLE_BAR_HEIGHTS.map((height, index) => (
					<div
						key={index}
						className='flex-1 rounded-t-sm'
						style={{ height: `${height}%`, backgroundColor: brandColor, opacity: 0.45 + index * 0.1 }}
					/>
				))}
			</div>
		</div>
	);
}

function resolveDefaultImageUrl(branding: BrandingState): string | null {
	const isWhiteLabeled = branding.enabled && branding.updatedAt !== null;
	if (!isWhiteLabeled) {
		return '/appicon.png';
	}
	return branding.hasLogo ? brandingAssetUrl('logo', branding.updatedAt) : null;
}
