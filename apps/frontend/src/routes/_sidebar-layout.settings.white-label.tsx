/* @license Enterprise */

import { useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Lock, Upload, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard, SettingsPageWrapper } from '@/components/ui/settings-card';
import { buildBrandVars } from '@/components/brand-color';
import { requireAdminNonCloud } from '@/lib/require-admin';
import { useTheme } from '@/contexts/theme.provider';
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
	const [brandColor, setBrandColor] = useState<string | null>(null);
	const [pending, setPending] = useState<Partial<Record<AssetKind, PendingAsset | null>>>({});
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const lastSyncedRef = useRef({ appName: '', tabTitle: '', brandColor: null as string | null });

	useEffect(() => {
		const prev = lastSyncedRef.current;
		const next = {
			appName: branding.appName ?? '',
			tabTitle: branding.tabTitle ?? '',
			brandColor: branding.brandColor ?? null,
		};

		setAppName((current) => (current === prev.appName ? next.appName : current));
		setTabTitle((current) => (current === prev.tabTitle ? next.tabTitle : current));
		setBrandColor((current) => (current === prev.brandColor ? next.brandColor : current));
		lastSyncedRef.current = next;
	}, [branding.appName, branding.tabTitle, branding.brandColor]);

	const updateMutation = useMutation({
		...trpc.branding.update.mutationOptions(),
		onSuccess: async (_data, variables) => {
			setError(null);
			setSuccess(true);
			setAppName(variables.appName ?? '');
			setTabTitle(variables.tabTitle ?? '');
			setBrandColor(variables.brandColor ?? null);
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
			brandColor: brandColor ?? null,
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
		brandColor !== (branding.brandColor ?? null) ||
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
						Replace the nao name, logo, favicon and brand color with your own branding. Visible to every
						user of this instance.
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

				<SettingsCard
					title='Brand color'
					description='Applied to buttons, links and accents across the app. Leave empty to keep the default nao purple.'
				>
					<BrandColorPicker value={brandColor} onChange={setBrandColor} disabled={disabled} />
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
							setBrandColor(branding.brandColor ?? null);
							setPending({});
						}}
					>
						Discard
					</Button>
					<Button
						size='sm'
						variant='primary-gradient'
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
					Customize your tab title, logo, favicon and brand color with your own branding. Activate a nao
					Enterprise license with the <code>white-label</code> feature to enable this page.
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

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_BRAND_COLOR = '#522bff';

function BrandColorPicker({
	value,
	onChange,
	disabled,
}: {
	value: string | null;
	onChange: (v: string | null) => void;
	disabled?: boolean;
}) {
	const [draft, setDraft] = useState(value ?? '');
	const effectiveColor = value ?? DEFAULT_BRAND_COLOR;

	useEffect(() => {
		setDraft(value ?? '');
	}, [value]);

	const commitDraft = (raw: string) => {
		const v = raw.trim();
		setDraft(raw);
		if (v === '') {
			onChange(null);
		} else if (HEX_RE.test(v)) {
			onChange(v);
		}
	};

	return (
		<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4'>
			<div className='min-w-0 flex flex-1 items-center  gap-3'>
				<input
					type='color'
					aria-label='Brand color'
					value={effectiveColor}
					onChange={(e) => onChange(e.target.value)}
					disabled={disabled}
					className='h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md bg-transparent p-0 shadow-xs disabled:pointer-events-none disabled:opacity-50 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none'
				/>
				<Input
					value={draft}
					placeholder={DEFAULT_BRAND_COLOR}
					onChange={(e) => commitDraft(e.target.value)}
					onBlur={() => setDraft(value ?? '')}
					disabled={disabled}
					className='w-28 font-mono uppercase placeholder:normal-case'
				/>
				<BrandColorPreview color={effectiveColor} />
			</div>
			<div className='self-end'>
				{value && (
					<Button
						variant='ghost'
						size='sm'
						className='h-8 border'
						onClick={() => onChange(null)}
						disabled={disabled}
					>
						Reset
					</Button>
				)}
			</div>
		</div>
	);
}

function BrandColorPreview({ color }: { color: string }) {
	const ref = useRef<HTMLDivElement>(null);
	const { theme } = useTheme();

	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}
		const isDark = theme === 'dark' || (theme === 'system' && document.documentElement.classList.contains('dark'));
		const vars = buildBrandVars(color, isDark ? 'dark' : 'light');
		for (const [key, val] of Object.entries(vars)) {
			el.style.setProperty(key, val);
		}
	}, [color, theme]);

	return (
		<div className='flex items-center gap-2'>
			<ArrowRight className='size-4' />
			<div ref={ref} className='flex flex-wrap items-center gap-4 bg-background'>
				<Button size='sm' variant='primary-gradient'>
					Button
				</Button>
				<Button size='sm' variant='link' className='px-0'>
					Link
				</Button>
				<Badge variant='admin'>Badge</Badge>
			</div>
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
