/* @license Enterprise */

import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { requireAdminNonCloud } from '@/lib/require-admin';
import { brandingAssetUrl, useBranding } from '@/hooks/use-branding';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/white-label')({
	beforeLoad: requireAdminNonCloud,
	component: WhiteLabelPage,
});

const MAX_BYTES = 512 * 1024;
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon';

type AssetKind = 'logo' | 'favicon';

interface PendingAsset {
	data: string;
	mediaType: string;
	previewUrl: string;
}

function WhiteLabelPage() {
	const queryClient = useQueryClient();
	const features = useQuery(trpc.license.getFeatures.queryOptions());
	const branding = useBranding();
	const isWhiteLabelEnabled = features.data?.['white-label'] === true;

	const [appName, setAppName] = useState('');
	const [tabTitle, setTabTitle] = useState('');
	const [pending, setPending] = useState<Partial<Record<AssetKind, PendingAsset | null>>>({});
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const lastSyncedNamesRef = useRef({ appName: '', tabTitle: '' });

	useEffect(() => {
		const previousNames = lastSyncedNamesRef.current;
		const nextNames = {
			appName: branding.appName ?? '',
			tabTitle: branding.tabTitle ?? '',
		};

		setAppName((current) => (current === previousNames.appName ? nextNames.appName : current));
		setTabTitle((current) => (current === previousNames.tabTitle ? nextNames.tabTitle : current));
		lastSyncedNamesRef.current = nextNames;
	}, [branding.appName, branding.tabTitle]);

	const updateMutation = useMutation({
		...trpc.branding.update.mutationOptions(),
		onSuccess: async (_data, variables) => {
			setError(null);
			setSuccess(true);
			setAppName(variables.appName ?? '');
			setTabTitle(variables.tabTitle ?? '');
			setPending({});
			await queryClient.invalidateQueries({ queryKey: trpc.branding.getPublic.queryKey() });
		},
		onError: (err) => {
			setSuccess(false);
			setError(err.message);
		},
	});

	const handleFile = (kind: AssetKind, file: File) => {
		setError(null);
		setSuccess(false);
		if (file.size > MAX_BYTES) {
			setError(`Image too large (${Math.round(file.size / 1024)}KB). Max ${MAX_BYTES / 1024}KB.`);
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const result = reader.result as string;
			const commaIdx = result.indexOf(',');
			const data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
			setPending((p) => ({ ...p, [kind]: { data, mediaType: file.type, previewUrl: result } }));
		};
		reader.readAsDataURL(file);
	};

	const clearPending = (kind: AssetKind) => setPending((p) => ({ ...p, [kind]: undefined }));

	const handleSave = () => {
		updateMutation.mutate({
			appName: appName.trim() ? appName.trim() : null,
			tabTitle: tabTitle.trim() ? tabTitle.trim() : null,
			...(pending.logo !== undefined
				? {
						logo: pending.logo ? { data: pending.logo.data, mediaType: pending.logo.mediaType } : null,
					}
				: {}),
			...(pending.favicon !== undefined
				? {
						favicon: pending.favicon
							? { data: pending.favicon.data, mediaType: pending.favicon.mediaType }
							: null,
					}
				: {}),
		});
	};

	const hasChanges =
		appName !== (branding.appName ?? '') ||
		tabTitle !== (branding.tabTitle ?? '') ||
		pending.logo !== undefined ||
		pending.favicon !== undefined;

	const disabled = !isWhiteLabelEnabled;

	return (
		<SettingsPageWrapper>
			<div className='flex flex-col gap-6'>
				<div>
					<div className='flex items-center gap-2'>
						<h1 className='text-lg font-semibold text-foreground'>White-label</h1>
						<Badge variant='ghost' className='bg-primary/5 text-primary uppercase text-[6px] px-1 py-0.5'>
							Enterprise
						</Badge>
					</div>
					<p className='text-sm text-muted-foreground mt-1'>
						Replace the nao name, logo and favicon with your own branding. Visible to every user of this
						instance.
					</p>
				</div>

				{!isWhiteLabelEnabled && <EnterpriseNudge />}

				<SettingsCard title='Names' description='Shown in the browser tab and across the UI in place of "nao".'>
					<LabeledInput
						label='App name'
						placeholder='Acme Analytics'
						value={appName}
						onChange={setAppName}
						disabled={disabled}
						helper='Used as fallback text when a logo is missing.'
					/>
					<LabeledInput
						label='Browser tab title'
						placeholder='Acme — Chat with your data'
						value={tabTitle}
						onChange={setTabTitle}
						disabled={disabled}
					/>
				</SettingsCard>

				<SettingsCard title='Logos & favicon' description='PNG, JPG, SVG, WebP or ICO up to 512KB.'>
					<AssetUpload
						label='Logo'
						helper='Shown in the sidebar and on the login and sign-up pages.'
						accept={ACCEPTED_TYPES}
						current={branding.hasLogo ? brandingAssetUrl('logo', branding.updatedAt) : null}
						pending={pending.logo ?? null}
						pendingSet={pending.logo !== undefined}
						onPick={(f) => handleFile('logo', f)}
						onClearPending={() => clearPending('logo')}
						onReset={() => setPending((p) => ({ ...p, logo: null }))}
						disabled={disabled}
					/>
					<AssetUpload
						label='Favicon'
						helper='Shown in the browser tab.'
						accept={ACCEPTED_TYPES}
						current={branding.hasFavicon ? brandingAssetUrl('favicon', branding.updatedAt) : null}
						pending={pending.favicon ?? null}
						pendingSet={pending.favicon !== undefined}
						onPick={(f) => handleFile('favicon', f)}
						onClearPending={() => clearPending('favicon')}
						onReset={() => setPending((p) => ({ ...p, favicon: null }))}
						disabled={disabled}
					/>
				</SettingsCard>

				{error && (
					<div className='text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md border border-destructive/30'>
						{error}
					</div>
				)}
				{success && (
					<div className='text-sm text-emerald-600 dark:text-emerald-500 bg-emerald-500/10 px-3 py-2 rounded-md border border-emerald-500/30'>
						Branding saved.
					</div>
				)}

				<div className='flex justify-end gap-2'>
					<Button
						variant='outline'
						size='sm'
						disabled={!hasChanges || updateMutation.isPending}
						onClick={() => {
							setAppName(branding.appName ?? '');
							setTabTitle(branding.tabTitle ?? '');
							setPending({});
						}}
					>
						Discard
					</Button>
					<Button
						size='sm'
						disabled={disabled || !hasChanges || updateMutation.isPending}
						onClick={handleSave}
					>
						{updateMutation.isPending ? 'Saving…' : 'Save changes'}
					</Button>
				</div>
			</div>
		</SettingsPageWrapper>
	);
}

function EnterpriseNudge() {
	return (
		<div className='flex items-start gap-3 p-4 rounded-xl border border-primary/30 bg-primary/5'>
			<div className='shrink-0 rounded-full p-2 bg-primary/10 text-primary'>
				<Lock className='size-4' />
			</div>
			<div className='flex flex-col gap-1 min-w-0'>
				<div className='flex items-center gap-2'>
					<span className='font-semibold text-foreground'>White-label is an Enterprise feature</span>
					<Badge variant='ghost' className='bg-primary/10 text-primary uppercase text-[10px]'>
						Enterprise
					</Badge>
				</div>
				<p className='text-sm text-muted-foreground'>
					Customize your tab title, logo and favicon with your own branding. Activate a nao Enterprise license
					with the <code>white-label</code> feature to enable this page.
				</p>
			</div>
		</div>
	);
}

function LabeledInput({
	label,
	helper,
	value,
	onChange,
	placeholder,
	disabled,
}: {
	label: string;
	helper?: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	disabled?: boolean;
}) {
	return (
		<div className='flex flex-col gap-1.5'>
			<label className='text-sm font-medium text-foreground'>{label}</label>
			<Input
				value={value}
				placeholder={placeholder}
				onChange={(e) => onChange(e.target.value)}
				disabled={disabled}
			/>
			{helper && <p className='text-xs text-muted-foreground'>{helper}</p>}
		</div>
	);
}

interface AssetUploadProps {
	label: string;
	helper: string;
	accept: string;
	current: string | null;
	pending: PendingAsset | null;
	pendingSet: boolean;
	onPick: (file: File) => void;
	onClearPending: () => void;
	onReset: () => void;
	disabled?: boolean;
}

function AssetUpload({
	label,
	helper,
	accept,
	current,
	pending,
	pendingSet,
	onPick,
	onClearPending,
	onReset,
	disabled,
}: AssetUploadProps) {
	const previewUrl = pendingSet ? (pending?.previewUrl ?? null) : current;

	return (
		<div className='flex items-center gap-4'>
			<div
				className={cn(
					'size-16 rounded-md border border-dashed border-border bg-muted/30 flex items-center justify-center overflow-hidden shrink-0',
					disabled && 'opacity-60',
				)}
			>
				{previewUrl ? (
					<img src={previewUrl} alt={label} className='max-w-full max-h-full object-contain' />
				) : (
					<span className='text-[10px] text-muted-foreground uppercase'>None</span>
				)}
			</div>
			<div className='flex flex-col gap-1 flex-1 min-w-0'>
				<span className='text-sm font-medium text-foreground'>{label}</span>
				<span className='text-xs text-muted-foreground'>{helper}</span>
				{pendingSet && (
					<span className='text-xs text-primary'>
						{pending ? 'New image selected — save to apply.' : 'Marked for removal — save to apply.'}
					</span>
				)}
			</div>
			<div className='flex items-center gap-2 shrink-0'>
				<label
					className={cn(
						'inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-input bg-background text-sm cursor-pointer hover:bg-accent',
						disabled && 'pointer-events-none opacity-50',
					)}
				>
					<Upload className='size-3.5' />
					Upload
					<input
						type='file'
						accept={accept}
						className='hidden'
						disabled={disabled}
						onChange={(e) => {
							const file = e.target.files?.[0];
							if (file) {
								onPick(file);
							}
							e.target.value = '';
						}}
					/>
				</label>
				{pendingSet ? (
					<Button variant='ghost' size='sm' onClick={onClearPending} disabled={disabled}>
						<X className='size-3.5' />
						Undo
					</Button>
				) : current ? (
					<Button variant='ghost' size='sm' onClick={onReset} disabled={disabled}>
						Remove
					</Button>
				) : null}
			</div>
		</div>
	);
}
