/* @license Enterprise */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Upload, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { buildBrandVars } from '@/components/brand-color';
import NaoLogoAnimated from '@/components/icons/nao-logo-animated';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsCard } from '@/components/ui/settings-card';
import { useTheme } from '@/contexts/theme.provider';
import { brandingAssetUrl, DEFAULT_BRAND_COLOR, useBranding } from '@/hooks/use-branding';
import { useLicenseFeatures } from '@/hooks/use-license';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const MAX_BYTES = 512 * 1024;
const ACCEPTED_TYPES = 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PREVIEW_ANIMATION_MS = 2500;

type AssetKind = 'logo' | 'favicon';

interface PendingAsset {
	data: string;
	mediaType: string;
	previewUrl: string;
}

interface AssetUploadProps {
	label: string;
	helper: string;
	accept: string;
	current: string | null;
	pending: PendingAsset | null;
	pendingSet: boolean;
	isAdmin: boolean;
	onPick: (file: File) => void;
	onClearPending: () => void;
	onReset: () => void;
	disabled?: boolean;
}

interface WhiteLabelSettingsProps {
	isAdmin: boolean;
}

export function WhiteLabelSettings({ isAdmin }: WhiteLabelSettingsProps) {
	const queryClient = useQueryClient();
	const features = useLicenseFeatures();
	const branding = useBranding();
	const customColor = branding.enabled ? branding.brandColor : null;
	const isWhiteLabelEnabled = features.data?.['white-label'] === true;

	const [appName, setAppName] = useState('');
	const [tabTitle, setTabTitle] = useState('');
	const [brandColor, setBrandColor] = useState<string | null>(null);
	const [pending, setPending] = useState<Partial<Record<AssetKind, PendingAsset | null>>>({});
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState(false);
	const lastSyncedRef = useRef({ appName: '', tabTitle: '', brandColor: null as string | null });

	useEffect(() => {
		const previous = lastSyncedRef.current;
		const next = {
			appName: branding.appName ?? '',
			tabTitle: branding.tabTitle ?? '',
			brandColor: customColor,
		};

		setAppName((current) => (current === previous.appName ? next.appName : current));
		setTabTitle((current) => (current === previous.tabTitle ? next.tabTitle : current));
		setBrandColor((current) => (current === previous.brandColor ? next.brandColor : current));
		lastSyncedRef.current = next;
	}, [branding.appName, branding.tabTitle, customColor]);

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
		onError: (mutationError) => {
			setSuccess(false);
			setError(mutationError.message);
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
			const commaIndex = result.indexOf(',');
			const data = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
			setPending((previous) => ({
				...previous,
				[kind]: { data, mediaType: file.type, previewUrl: result },
			}));
		};
		reader.readAsDataURL(file);
	};

	const clearPending = (kind: AssetKind) => setPending((previous) => ({ ...previous, [kind]: undefined }));

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

	const isReadOnly = !isWhiteLabelEnabled || !isAdmin;

	return (
		<div className='flex flex-col gap-6'>
			<SettingsCard
				title='Names'
				description='Replace the nao name and browser tab title across this instance.'
				action={!isWhiteLabelEnabled ? <UpgradeToEnterprise /> : undefined}
			>
				<LockedFieldset disabled={isReadOnly}>
					<LabeledInput
						label='App name'
						placeholder='Acme Analytics'
						value={appName}
						onChange={setAppName}
						disabled={isReadOnly}
						helper='Used as fallback text when a logo is missing.'
					/>
					<LabeledInput
						label='Browser tab title'
						placeholder='Acme — Chat with your data'
						value={tabTitle}
						onChange={setTabTitle}
						disabled={isReadOnly}
					/>
				</LockedFieldset>
			</SettingsCard>

			<SettingsCard
				title='Logos & favicon'
				description='PNG, JPG, SVG, WebP or ICO up to 512KB.'
				action={!isWhiteLabelEnabled ? <UpgradeToEnterprise /> : undefined}
			>
				<LockedFieldset disabled={isReadOnly}>
					<AssetUpload
						label='Logo'
						helper='Shown in the sidebar and on the login and sign-up pages.'
						accept={ACCEPTED_TYPES}
						current={branding.hasLogo ? brandingAssetUrl('logo', branding.updatedAt) : null}
						pending={pending.logo ?? null}
						pendingSet={pending.logo !== undefined}
						isAdmin={isAdmin}
						onPick={(file) => handleFile('logo', file)}
						onClearPending={() => clearPending('logo')}
						onReset={() => setPending((previous) => ({ ...previous, logo: null }))}
						disabled={isReadOnly}
					/>
					<AssetUpload
						label='Favicon'
						helper='Shown in the browser tab.'
						accept={ACCEPTED_TYPES}
						current={branding.hasFavicon ? brandingAssetUrl('favicon', branding.updatedAt) : null}
						pending={pending.favicon ?? null}
						pendingSet={pending.favicon !== undefined}
						isAdmin={isAdmin}
						onPick={(file) => handleFile('favicon', file)}
						onClearPending={() => clearPending('favicon')}
						onReset={() => setPending((previous) => ({ ...previous, favicon: null }))}
						disabled={isReadOnly}
					/>
				</LockedFieldset>
			</SettingsCard>

			<SettingsCard
				title='Brand color'
				description='Applied to buttons, links and accents across the app. Leave empty to keep the default nao purple.'
				action={!isWhiteLabelEnabled ? <UpgradeToEnterprise /> : undefined}
			>
				<LockedFieldset disabled={isReadOnly}>
					<BrandColorPicker
						value={brandColor}
						onChange={setBrandColor}
						isAdmin={isAdmin}
						disabled={isReadOnly}
					/>
				</LockedFieldset>
			</SettingsCard>

			{error && (
				<div
					className={cn(
						'text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md border border-destructive/30',
						isReadOnly && 'pointer-events-none opacity-60',
					)}
				>
					{error}
				</div>
			)}
			{success && (
				<div
					className={cn(
						'text-sm text-emerald-600 dark:text-emerald-500 bg-emerald-500/10 px-3 py-2 rounded-md border border-emerald-500/30',
						isReadOnly && 'pointer-events-none opacity-60',
					)}
				>
					Branding saved.
				</div>
			)}

			{isAdmin && (
				<div
					className={cn('flex justify-end gap-2', isReadOnly && 'pointer-events-none opacity-60')}
					aria-disabled={isReadOnly}
				>
					<Button
						variant='outline'
						size='sm'
						disabled={isReadOnly || !hasChanges || updateMutation.isPending}
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
						disabled={isReadOnly || !hasChanges || updateMutation.isPending}
						onClick={handleSave}
					>
						{updateMutation.isPending ? 'Saving…' : 'Save changes'}
					</Button>
				</div>
			)}
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
	onChange: (value: string) => void;
	placeholder?: string;
	disabled?: boolean;
}) {
	const inputId = useId();
	const helperId = helper ? `${inputId}-description` : undefined;

	return (
		<div className='flex flex-col gap-1.5'>
			<label htmlFor={inputId} className='text-sm font-medium text-foreground'>
				{label}
			</label>
			<Input
				id={inputId}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				disabled={disabled}
				aria-describedby={helperId}
			/>
			{helper && (
				<p id={helperId} className='text-xs text-muted-foreground'>
					{helper}
				</p>
			)}
		</div>
	);
}

function BrandColorPicker({
	value,
	onChange,
	isAdmin,
	disabled,
}: {
	value: string | null;
	onChange: (value: string | null) => void;
	isAdmin: boolean;
	disabled?: boolean;
}) {
	const [draft, setDraft] = useState(value ?? '');
	const effectiveColor = value ?? DEFAULT_BRAND_COLOR;

	useEffect(() => {
		setDraft(value ?? '');
	}, [value]);

	const commitDraft = (rawValue: string) => {
		const trimmedValue = rawValue.trim();
		setDraft(rawValue);
		if (trimmedValue === '') {
			onChange(null);
		} else if (HEX_RE.test(trimmedValue)) {
			onChange(trimmedValue);
		}
	};

	return (
		<div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4'>
			<div className='min-w-0 flex flex-1 items-center gap-3'>
				<input
					type='color'
					aria-label='Brand color'
					value={effectiveColor}
					onChange={(event) => onChange(event.target.value)}
					disabled={disabled}
					className='h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md bg-transparent p-0 shadow-xs disabled:pointer-events-none disabled:opacity-50 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none'
				/>
				<Input
					value={draft}
					placeholder={DEFAULT_BRAND_COLOR}
					onChange={(event) => commitDraft(event.target.value)}
					onBlur={() => setDraft(value ?? '')}
					disabled={disabled}
					className='w-28 font-mono uppercase placeholder:normal-case'
				/>
				<BrandColorPreview color={effectiveColor} disabled={disabled} />
			</div>
			<div className='self-end'>
				{isAdmin && value && (
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

function BrandColorPreview({ color, disabled }: { color: string; disabled?: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	const { theme } = useTheme();
	const [runId, setRunId] = useState(0);
	const [animating, setAnimating] = useState(false);
	const isFirstRender = useRef(true);

	useEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		const isDark = theme === 'dark' || (theme === 'system' && document.documentElement.classList.contains('dark'));
		const variables = buildBrandVars(color, isDark ? 'dark' : 'light');
		for (const [key, value] of Object.entries(variables)) {
			element.style.setProperty(key, value);
		}
	}, [color, theme]);

	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}
		setRunId((currentRunId) => currentRunId + 1);
		setAnimating(true);
		const timeout = setTimeout(() => setAnimating(false), PREVIEW_ANIMATION_MS);
		return () => clearTimeout(timeout);
	}, [color]);

	return (
		<div className='flex items-center gap-2'>
			<ArrowRight className='size-4' />
			<div ref={ref} className='flex flex-wrap items-center gap-4 bg-background'>
				<Button size='sm' variant='primary-gradient' disabled={disabled}>
					Button
				</Button>
				<Button size='sm' variant='link' className='px-0' disabled={disabled}>
					Link
				</Button>
				<Badge variant='admin'>Badge</Badge>
				<NaoLogoAnimated key={runId} loop={animating} className='size-5' color={color} />
			</div>
		</div>
	);
}

function AssetUpload({
	label,
	helper,
	accept,
	current,
	pending,
	pendingSet,
	isAdmin,
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
					aria-disabled={disabled}
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
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (file) {
								onPick(file);
							}
							event.target.value = '';
						}}
					/>
				</label>
				{isAdmin &&
					(pendingSet ? (
						<Button variant='ghost' size='sm' onClick={onClearPending} disabled={disabled}>
							<X className='size-3.5' />
							Undo
						</Button>
					) : current ? (
						<Button variant='ghost' size='sm' onClick={onReset} disabled={disabled}>
							Remove
						</Button>
					) : null)}
			</div>
		</div>
	);
}
