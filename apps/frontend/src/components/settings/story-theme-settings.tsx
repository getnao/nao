import {
	DEFAULT_STORY_THEME,
	DEFAULT_STORY_THEME_PAIR,
	HEX_COLOR,
	MAX_CHART_SERIES_COLORS,
	MAX_STORY_LOGO_BYTES,
	MIN_CHART_SERIES_COLORS,
	normalizeBrandHeader,
	oppositeStoryThemeMode,
	sameThemePair,
	STORY_LOGO_MEDIA_TYPES,
	storyThemePairSchema,
} from '@nao/shared/story-theme';
import { deriveStoryThemeVariant, mapPairBrand } from '@nao/shared/story-theme-pair';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StoryThemeGeneration } from '@nao/shared/story-theme-generation';
import type { StoryTheme, StoryThemePair } from '@nao/shared/story-theme';

import type { PendingGeneration } from '@/components/settings/story-theme-editor-context';
import type { InspirationOutcome } from '@/components/settings/story-theme-inspiration';
import type { ViewedThemeVersion } from '@/components/settings/story-theme-recorded-sources';
import { StoryThemeTypographyEditor } from '@/components/settings/story-theme-typography-editor';
import {
	STORY_THEME_MODE_OPTIONS,
	useInvalidateStoryTheme,
	useStoryThemeEditor,
} from '@/components/settings/story-theme-editor-context';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { StoryThemeInspiration } from '@/components/settings/story-theme-inspiration';
import { StoryThemePreviewPanel } from '@/components/settings/story-theme-preview';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { IconSegmentedToggle } from '@/components/ui/icon-segmented-toggle';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useSidePanel } from '@/contexts/side-panel';
import { trpc } from '@/main';

const BORDER_WIDTHS = [0, 1, 2, 3, 4];
const HEADER_LAYOUTS = {
	none: { header: 'none', showName: false, label: 'None' },
	logo: { header: 'logo', showName: false, label: 'Display logo' },
	name: { header: 'name', showName: false, label: 'Display brand name' },
	'logo-name': { header: 'logo', showName: true, label: 'Display logo and brand name' },
	band: { header: 'band', showName: false, label: 'Display logo in a coloured band' },
	'band-name': { header: 'band', showName: true, label: 'Display logo and brand name in a coloured band' },
} as const satisfies Record<string, Pick<StoryTheme['brand'], 'header' | 'showName'> & { label: string }>;
type HeaderLayout = keyof typeof HEADER_LAYOUTS;
const HEADER_LAYOUT_OPTIONS = Object.entries(HEADER_LAYOUTS).map(([value, layout]) => ({
	value: value as HeaderLayout,
	label: layout.label,
}));
const KPI_STYLE_OPTIONS = [
	{ value: 'plain', label: 'Plain' },
	{ value: 'lead', label: 'Highlight the first' },
	{ value: 'tinted', label: 'Tinted per series' },
] as const;

interface StoryThemeSettingsProps {
	isAdmin: boolean;
}

export function StoryThemeSettings({ isAdmin }: StoryThemeSettingsProps) {
	const systemConfig = useQuery(trpc.system.getPublicConfig.queryOptions());
	if (!systemConfig.data) {
		return (
			<div className='flex justify-center py-12'>
				<Spinner />
			</div>
		);
	}
	if (!systemConfig.data.betaCustomStoriesEnabled) {
		return (
			<SettingsCard>
				<Empty className='whitespace-normal'>
					This feature is currently in beta. To enable it, set the environment variable{' '}
					<code className='rounded bg-muted px-1 py-0.5 font-mono text-xs'>
						BETA_CUSTOM_STORIES_ENABLED=true
					</code>{' '}
					on your nao instance and restart it.
				</Empty>
			</SettingsCard>
		);
	}
	return <StoryThemeEditor isAdmin={isAdmin} />;
}

function StoryThemeEditor({ isAdmin }: { isAdmin: boolean }) {
	const state = useQuery(trpc.storyTheme.getState.queryOptions());
	const {
		theme,
		setTheme,
		mode,
		setMode,
		pendingGeneration,
		setPendingGeneration,
		viewingVersionIndex,
		setViewingVersionIndex,
	} = useStoryThemeEditor();
	const versionsQuery = useQuery(trpc.storyTheme.listVersions.queryOptions());
	const viewedVersion = viewedVersionAt(versionsQuery.data?.versions ?? [], viewingVersionIndex);
	const [error, setError] = useState<string | null>(null);
	const [inspiration, setInspiration] = useState<InspirationOutcome | null>(null);
	const openPreview = usePreviewPanel();
	const invalidate = useInvalidateStoryTheme();

	const whiteLabelLogo = state.data?.whiteLabelIdentity?.logo ?? null;
	const saved = state.data?.theme ? mapPairBrand(state.data.theme, normalizeBrandHeader) : null;
	const enabled = state.data?.enabled ?? false;
	const baseline = saved ?? DEFAULT_STORY_THEME_PAIR;
	const otherMode = oppositeStoryThemeMode(mode);

	useEffect(() => {
		if (state.data && theme === null) {
			setTheme(baseline);
		}
	}, [baseline, state.data, theme, setTheme]);

	const onError = (mutationError: { message: string }) => setError(mutationError.message);
	const revertPending = () => {
		setTheme(baseline);
		setInspiration(null);
		setPendingGeneration(null);
	};

	const save = useMutation({
		...trpc.storyTheme.save.mutationOptions(),
		onSuccess: async () => {
			setInspiration(null);
			setPendingGeneration(null);
			await invalidate();
		},
		onError,
	});
	const setEnabled = useMutation({ ...trpc.storyTheme.setEnabled.mutationOptions(), onSuccess: invalidate, onError });

	if (!theme) {
		return (
			<div className='flex justify-center py-12'>
				<Spinner className='size-5' />
			</div>
		);
	}

	const isReadOnly = !isAdmin;
	const isPending = save.isPending || setEnabled.isPending;
	const isDirty = !sameThemePair(theme, baseline);
	const isDefault = sameThemePair(theme, DEFAULT_STORY_THEME_PAIR);
	const controlsDisabled = isReadOnly || isPending;
	const variant = theme[mode];

	const validate = (): StoryThemePair | null => {
		const result = storyThemePairSchema.safeParse(theme);
		if (!result.success) {
			setError(result.error.issues[0]?.message ?? 'Invalid theme.');
			return null;
		}
		setError(null);
		return result.data;
	};

	const update = <Group extends keyof StoryTheme>(group: Group, patch: Partial<StoryTheme[Group]>) =>
		setTheme((current) =>
			current
				? { ...current, [mode]: { ...current[mode], [group]: { ...current[mode][group], ...patch } } }
				: current,
		);

	/** Identity is the same in both schemes, so it is written to both variants at once. */
	const updateIdentity = (patch: Partial<Pick<StoryTheme['brand'], 'name' | 'logo' | 'header' | 'showName'>>) =>
		setTheme((current) => {
			if (!current) {
				return current;
			}
			const headerPatch = defaultBrandHeaderPatch(current[mode].brand, patch);
			return mapPairBrand(current, (brand) => ({ ...brand, ...headerPatch }));
		});

	const deriveFromOther = () =>
		setTheme((current) =>
			current ? { ...current, [mode]: deriveStoryThemeVariant(current[otherMode], mode) } : current,
		);

	return (
		<>
			<SettingsCard
				title='Custom story theme'
				description={
					isReadOnly
						? 'Colours, fonts, blocks, tables and charts applied to every custom story in this project, in a light and a dark variant that follow nao’s colour scheme. Only admins can change this.'
						: 'Colours, fonts, blocks, tables and charts applied to every custom story in this project, in a light and a dark variant that follow nao’s colour scheme.'
				}
			>
				<SettingsControlRow
					id='story-theme-enabled'
					label='Apply to custom stories'
					description={
						saved
							? 'Turn off to fall back to the classic nao look without losing the saved theme.'
							: 'Turn on to apply nao defaults to custom stories.'
					}
					control={
						<Switch
							id='story-theme-enabled'
							checked={enabled}
							onCheckedChange={(next) => setEnabled.mutate({ enabled: next })}
							disabled={controlsDisabled}
						/>
					}
				/>
			</SettingsCard>

			{isAdmin && (
				<StoryThemeInspiration
					disabled={controlsDisabled}
					outcome={inspiration}
					viewedVersion={viewedVersion}
					onLeaveVersion={() => setViewingVersionIndex(null)}
					logo={manualLogoOf(theme, whiteLabelLogo)}
					onGenerated={(label, result) => {
						setInspiration({ label, generation: result.generation });
						const generated = keepLogo(result.theme, manualLogoOf(theme, whiteLabelLogo));
						setPendingGeneration({ record: result.generation, theme: generated });
						setTheme(generated);
						setMode(result.sourceMode);
						openPreview.show();
					}}
					onDismiss={() => setInspiration(null)}
				/>
			)}

			<SettingsCard
				title='Variant'
				description='Which variant the settings below edit and the preview shows. Stories pick the one matching the viewer’s colour scheme.'
				divide
			>
				<SettingsControlRow
					label='Editing'
					description={mode === 'dark' ? 'The dark variant.' : 'The light variant.'}
					control={
						<IconSegmentedToggle options={STORY_THEME_MODE_OPTIONS} value={mode} onValueChange={setMode} />
					}
				/>
				{isAdmin && (
					<SettingsControlRow
						label={`Derive from the ${otherMode} variant`}
						description={`Rebuild this variant’s colours from the ${otherMode} one, keeping fonts and shapes.`}
						control={
							<Button
								variant='outline'
								className='rounded-full'
								onClick={deriveFromOther}
								disabled={controlsDisabled}
							>
								Derive
							</Button>
						}
					/>
				)}
			</SettingsCard>

			<LockedFieldset disabled={controlsDisabled}>
				<SettingsCard
					title='Brand header'
					description='How every story opens: the logo or brand name, bare on the page or in a coloured band.'
					divide
				>
					<SelectRow
						label='Header style'
						description='Add the name beside a logo that is a symbol rather than a wordmark. Without a logo, the name is shown instead.'
						value={headerLayoutOf(variant.brand)}
						options={HEADER_LAYOUT_OPTIONS}
						onChange={(layout) => {
							const { header, showName } = HEADER_LAYOUTS[layout];
							updateIdentity({ header, showName });
						}}
					/>
					<TextRow
						label='Brand name'
						description='Shown when there is no logo, and as the logo’s alternative text.'
						value={variant.brand.name}
						onChange={(name) => updateIdentity({ name })}
						placeholder='Acme'
					/>
					<LogoRow
						value={variant.brand.logo}
						onChange={(logo) => updateIdentity({ logo })}
						onError={setError}
					/>
					{variant.brand.header === 'band' && (
						<ColorRow
							label='Band colour'
							description='Behind the header band.'
							value={variant.brand.headerBackground}
							onChange={(headerBackground) => update('brand', { headerBackground })}
						/>
					)}
				</SettingsCard>

				<SettingsCard title='Colours' description='Page, text and accent.' divide>
					<ColorRow
						label='Page background'
						description='Behind the whole story.'
						value={variant.surfaces.page}
						onChange={(page) => update('surfaces', { page })}
					/>
					<ColorRow
						label='Recessed surfaces'
						description='Inactive controls and hover states.'
						value={variant.surfaces.sunken}
						onChange={(sunken) => update('surfaces', { sunken })}
					/>
					<ColorRow
						label='Heading colour'
						description='Titles and KPI values.'
						value={variant.text.headingColor}
						onChange={(headingColor) => update('text', { headingColor })}
					/>
					<ColorRow
						label='Body colour'
						description='Paragraphs, lists and table cells.'
						value={variant.text.bodyColor}
						onChange={(bodyColor) => update('text', { bodyColor })}
					/>
					<ColorRow
						label='Muted colour'
						description='Axis ticks, captions and helper text.'
						value={variant.text.mutedColor}
						onChange={(mutedColor) => update('text', { mutedColor })}
					/>
					<ColorRow
						label='Accent'
						description='Links, active filters and selected states.'
						value={variant.accent.color}
						onChange={(color) => update('accent', { color })}
					/>
					<ColorRow
						label='Text on accent'
						description='Text placed on the accent colour.'
						value={variant.accent.ink}
						onChange={(ink) => update('accent', { ink })}
					/>
				</SettingsCard>

				<SettingsCard
					title='Fonts'
					description='Heading and body typefaces. If you pick a web font, add its CSS link so both names load.'
					divide
				>
					<TextRow
						label='Heading font'
						description='Titles and KPI values.'
						value={variant.text.headingFont}
						onChange={(headingFont) => update('text', { headingFont })}
						placeholder={DEFAULT_STORY_THEME.text.headingFont}
					/>
					<TextRow
						label='Body font'
						description='Paragraphs, lists and everything else.'
						value={variant.text.bodyFont}
						onChange={(bodyFont) => update('text', { bodyFont })}
						placeholder={DEFAULT_STORY_THEME.text.bodyFont}
					/>
					<TextRow
						label='Font CSS URL'
						description='One Google Fonts (or Bunny / Adobe) CSS link that loads both fonts above. Skip this for Arial, Helvetica and other system fonts.'
						value={variant.text.fontStylesheets[0] ?? ''}
						onChange={(value) => update('text', { fontStylesheets: value.trim() ? [value.trim()] : [] })}
						placeholder='https://fonts.googleapis.com/css2?family=Inter'
					/>
				</SettingsCard>

				<SettingsCard
					title='Typography'
					description='Face, weight, case, italics, letter spacing and size for each kind of text.'
				>
					<StoryThemeTypographyEditor
						theme={variant}
						onChange={(typography) => update('text', { typography })}
					/>
				</SettingsCard>

				<SettingsCard title='Text size' description='Scale of headings and body text.' divide>
					<NumberRow
						label='Heading size'
						description='Multiplier on heading sizes.'
						value={variant.text.headingScale}
						onChange={(headingScale) => update('text', { headingScale })}
						min={0.8}
						max={1.4}
						step={0.05}
					/>
					<NumberRow
						label='Body size'
						description='Paragraph size in px.'
						value={variant.text.bodySize}
						onChange={(bodySize) => update('text', { bodySize })}
						min={13}
						max={20}
					/>
					<NumberRow
						label='Line height'
						description='Paragraph line height.'
						value={variant.text.lineHeight}
						onChange={(lineHeight) => update('text', { lineHeight })}
						min={1.2}
						max={2}
						step={0.1}
					/>
				</SettingsCard>

				<SettingsCard title='Blocks' description='KPI tiles and charts share these.' divide>
					<ColorRow
						label='Background'
						description='Same as the page for a flat look.'
						value={variant.block.background}
						onChange={(background) => update('block', { background })}
					/>
					<ColorRow
						label='Border colour'
						description='Also used for rules and inputs.'
						value={variant.block.borderColor}
						onChange={(borderColor) => update('block', { borderColor })}
					/>
					<BorderWidthRow
						value={variant.block.borderWidth}
						onChange={(borderWidth) => update('block', { borderWidth })}
					/>
					<NumberRow
						label='Corner radius'
						description='In px, from square to very round.'
						value={variant.block.radius}
						onChange={(radius) => update('block', { radius })}
						min={0}
						max={28}
					/>
					<NumberRow
						label='Button radius'
						description='Buttons and filter chips, in px. 999 draws pills.'
						value={variant.block.controlRadius}
						onChange={(controlRadius) => update('block', { controlRadius })}
						min={0}
						max={999}
					/>
					<SelectRow
						label='KPI tiles'
						description='Highlight inverts the first tile of a row; tinted washes each tile with a series colour.'
						value={variant.block.kpiStyle}
						options={KPI_STYLE_OPTIONS}
						onChange={(kpiStyle) => update('block', { kpiStyle })}
					/>
				</SettingsCard>

				<SettingsCard
					title='Tables'
					description='Tables draw their own frame, styled apart from blocks.'
					divide
				>
					<ColorRow
						label='Background'
						description='Behind the rows.'
						value={variant.table.background}
						onChange={(background) => update('table', { background })}
					/>
					<ColorRow
						label='Header background'
						description='Column headers and the row-number column.'
						value={variant.table.headerBackground}
						onChange={(headerBackground) => update('table', { headerBackground })}
					/>
					<ColorRow
						label='Header text'
						description='Column labels.'
						value={variant.table.headerText}
						onChange={(headerText) => update('table', { headerText })}
					/>
					<ColorRow
						label='Border colour'
						description='Frame, header rule and cell dividers.'
						value={variant.table.borderColor}
						onChange={(borderColor) => update('table', { borderColor })}
					/>
					<BorderWidthRow
						description='Of the frame; corners follow the block radius.'
						value={variant.table.borderWidth}
						onChange={(borderWidth) => update('table', { borderWidth })}
					/>
					<SettingsControlRow
						id='story-theme-table-striped'
						label='Striped rows'
						description='Tint every other row with the header background.'
						control={
							<Switch
								id='story-theme-table-striped'
								checked={variant.table.stripedRows}
								onCheckedChange={(stripedRows) => update('table', { stripedRows })}
							/>
						}
					/>
				</SettingsCard>

				<SettingsCard title='Charts' description='Series colours are assigned in order.' divide>
					<SettingsControlRow
						label='Series palette'
						description={`Between ${MIN_CHART_SERIES_COLORS} and ${MAX_CHART_SERIES_COLORS} colours.`}
						control={
							<ChartSeriesControl
								value={variant.charts.series}
								onChange={(series) => update('charts', { series })}
							/>
						}
					/>
					<ColorRow
						label='Grid lines'
						description='Behind every chart.'
						value={variant.charts.grid}
						onChange={(grid) => update('charts', { grid })}
					/>
					<NumberRow
						label='Bar radius'
						description='Corner radius on vertical bars, in px. Horizontal bars stay pill-shaped.'
						value={variant.charts.barRadius}
						onChange={(barRadius) => update('charts', { barRadius })}
						min={0}
						max={12}
					/>
				</SettingsCard>
			</LockedFieldset>

			<div className='sticky bottom-0 -mx-4 -mb-6 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:-mb-8 md:px-8'>
				<div className='flex items-center gap-2'>
					{openPreview.button}
					{error && <p className='text-xs text-destructive'>{error}</p>}
				</div>
				{isAdmin && (
					<div className='flex items-center gap-2'>
						<Button
							variant='outline'
							className='rounded-full text-destructive hover:text-destructive'
							onClick={() => {
								setTheme(DEFAULT_STORY_THEME_PAIR);
								setInspiration(null);
								setPendingGeneration(null);
							}}
							disabled={isPending || isDefault}
						>
							Reset to nao defaults
						</Button>
						{isDirty && (
							<Button variant='outline' className='rounded-full' onClick={revertPending}>
								Revert
							</Button>
						)}
						<Button
							variant='primary-gradient'
							className='rounded-full'
							onClick={() => {
								const valid = validate();
								if (valid) {
									save.mutate({
										theme: valid,
										generation: generationToSave(pendingGeneration, valid),
									});
								}
							}}
							disabled={!isDirty}
						>
							{save.isPending ? 'Saving…' : 'Save'}
						</Button>
					</div>
				)}
			</div>
		</>
	);
}

/** Only an earlier saved version is shown read-only; the latest one stays editable. */
function viewedVersionAt(
	versions: { generation: StoryThemeGeneration | null }[],
	viewingVersionIndex: number | null,
): ViewedThemeVersion | null {
	if (viewingVersionIndex === null || viewingVersionIndex >= versions.length) {
		return null;
	}
	return { label: `Theme ${viewingVersionIndex + 1}`, generation: versions[viewingVersionIndex].generation };
}

function headerLayoutOf(brand: StoryTheme['brand']): HeaderLayout {
	const normalized = normalizeBrandHeader(brand);
	if (normalized.header === 'none' || normalized.header === 'name') {
		return normalized.header;
	}
	return normalized.showName ? `${normalized.header}-name` : normalized.header;
}

function defaultBrandHeaderPatch(
	brand: StoryTheme['brand'],
	patch: Partial<Pick<StoryTheme['brand'], 'name' | 'logo' | 'header' | 'showName'>>,
) {
	if ('header' in patch || 'showName' in patch) {
		return patch;
	}

	const next = { ...brand, ...patch };
	const hasName = next.name.trim().length > 0;
	const hasLogo = Boolean(next.logo);
	const hadName = brand.name.trim().length > 0;
	const hadLogo = Boolean(brand.logo);

	if (!hasName && !hasLogo) {
		return patch;
	}
	if (!hasLogo && hasName && brand.header !== 'none') {
		return { ...patch, header: 'name' as const, showName: false };
	}
	if (brand.showName && !hasName && hasLogo) {
		return { ...patch, header: 'logo' as const, showName: false };
	}
	if (brand.showName && hasName && !hasLogo) {
		return { ...patch, header: 'name' as const, showName: false };
	}
	if (brand.header === 'none' && !hadName && !hadLogo) {
		return { ...patch, header: hasLogo ? ('logo' as const) : ('name' as const), showName: hasName && hasLogo };
	}
	if (
		['logo', 'name', 'band'].includes(brand.header) &&
		!brand.showName &&
		hasName &&
		hasLogo &&
		(!hadName || !hadLogo)
	) {
		return { ...patch, header: brand.header === 'band' ? ('band' as const) : ('logo' as const), showName: true };
	}
	return patch;
}

function manualLogoOf(theme: StoryThemePair, whiteLabelLogo: string | null): string | null {
	const logo = theme.light.brand.logo ?? theme.dark.brand.logo;
	return logo && logo !== whiteLabelLogo ? logo : null;
}

/** A logo uploaded by hand survives a generation that brought none of its own. */
function keepLogo(generated: StoryThemePair, logo: string | null): StoryThemePair {
	if (!logo || generated.light.brand.logo || generated.dark.brand.logo) {
		return generated;
	}
	return mapPairBrand(generated, (brand) => ({ ...brand, logo }));
}

function generationToSave(pending: PendingGeneration | null, theme: StoryThemePair): StoryThemeGeneration | null {
	if (!pending) {
		return null;
	}
	return { ...pending.record, editedByHand: !sameThemePair(pending.theme, theme) };
}

function usePreviewPanel() {
	const sidePanel = useSidePanel();
	const { open, isVisible } = sidePanel;
	const sidePanelRef = useRef(sidePanel);
	sidePanelRef.current = sidePanel;

	useEffect(() => {
		sidePanelRef.current.open(<StoryThemePreviewPanel />);
		return () => sidePanelRef.current.close();
	}, []);

	const show = () => open(<StoryThemePreviewPanel />);
	const button = isVisible ? null : (
		<Button variant='outline' className='rounded-full' onClick={show}>
			<Eye className='size-4' />
			Show preview
		</Button>
	);

	return { button, show };
}

interface RowProps<Value> {
	label: string;
	description: string;
	value: Value;
	onChange: (value: Value) => void;
}

function ColorRow({ label, description, value, onChange }: RowProps<string>) {
	const [draft, setDraft] = useState(value);

	useEffect(() => {
		setDraft(value);
	}, [value]);

	const commit = (raw: string) => {
		setDraft(raw);
		if (HEX_COLOR.test(raw.trim())) {
			onChange(raw.trim().toLowerCase());
		}
	};

	return (
		<SettingsControlRow
			label={label}
			description={description}
			control={
				<div className='flex items-center gap-2'>
					<ColorSwatchInput label={label} value={value} onChange={onChange} />
					<Input
						value={draft}
						onChange={(event) => commit(event.target.value)}
						onBlur={() => setDraft(value)}
						className='w-28 font-mono'
						spellCheck={false}
						aria-label={`${label} hex value`}
					/>
				</div>
			}
		/>
	);
}

function ColorSwatchInput({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<input
			type='color'
			aria-label={label}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className='h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-md bg-transparent p-0 shadow-xs disabled:pointer-events-none disabled:opacity-50 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none'
		/>
	);
}

function ChartSeriesControl({ value, onChange }: { value: string[]; onChange: (series: string[]) => void }) {
	const replace = (index: number, color: string) => onChange(value.map((c, i) => (i === index ? color : c)));
	const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
	const add = () => onChange([...value, value[value.length - 1] ?? DEFAULT_STORY_THEME.charts.series[0]]);

	return (
		<div className='flex max-w-md flex-wrap items-center justify-end gap-2'>
			{value.map((color, index) => (
				<div key={index} className='flex relative'>
					<ColorSwatchInput
						label={`Series colour ${index + 1}`}
						value={color}
						onChange={(next) => replace(index, next)}
					/>
					{value.length > MIN_CHART_SERIES_COLORS && (
						<button
							type='button'
							aria-label={`Remove series colour ${index + 1}`}
							onClick={() => remove(index)}
							className='absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground'
						>
							<X className='size-2.5' />
						</button>
					)}
				</div>
			))}
			{value.length < MAX_CHART_SERIES_COLORS && (
				<Button variant='outline' size='icon-md' onClick={add} aria-label='Add series colour'>
					<Plus className='size-4' />
				</Button>
			)}
		</div>
	);
}

function BorderWidthRow({
	value,
	onChange,
	description = '0 draws no border.',
}: {
	value: number;
	onChange: (value: number) => void;
	description?: string;
}) {
	return (
		<SettingsControlRow
			label='Border width'
			description={description}
			control={
				<Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
					<SelectTrigger className='w-28'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{BORDER_WIDTHS.map((width) => (
							<SelectItem key={width} value={String(width)}>
								{width === 0 ? 'None' : `${width} px`}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
		/>
	);
}

interface SelectOption<Value extends string> {
	value: Value;
	label: string;
}

function SelectRow<const Value extends string>({
	label,
	description,
	value,
	options,
	onChange,
}: RowProps<Value> & { options: readonly SelectOption<Value>[] }) {
	const selected = options.some((option) => option.value === value) ? value : undefined;

	return (
		<SettingsControlRow
			label={label}
			description={description}
			control={
				<Select
					value={selected}
					onValueChange={(next) => {
						const option = options.find((candidate) => candidate.value === next);
						if (option) {
							onChange(option.value);
						}
					}}
				>
					<SelectTrigger className='w-44'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{options.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			}
		/>
	);
}

function LogoRow({
	value,
	onChange,
	onError,
}: {
	value: string | null;
	onChange: (logo: string | null) => void;
	onError: (message: string | null) => void;
}) {
	const pick = (file: File | undefined) => {
		if (!file) {
			return;
		}
		if (!(STORY_LOGO_MEDIA_TYPES as readonly string[]).includes(file.type)) {
			onError('The logo must be a PNG, JPEG, WebP or SVG image.');
			return;
		}
		if (file.size > MAX_STORY_LOGO_BYTES) {
			onError(`The logo is too large. Max ${MAX_STORY_LOGO_BYTES / 1024}KB.`);
			return;
		}
		readAsDataUri(file).then(
			(dataUri) => {
				onError(null);
				onChange(dataUri);
			},
			() => onError('The logo could not be read.'),
		);
	};

	return (
		<SettingsControlRow
			label='Logo'
			description='PNG, JPEG, WebP or SVG, up to 512KB. Shown in every story header, kept when a theme is generated, and read by the generation as a brand source.'
			control={
				<div className='flex items-center gap-2'>
					{value && (
						<div className='relative flex h-9 max-w-40 items-center rounded-md border bg-muted/30 px-2'>
							<img src={value} alt='Story logo' className='h-6 max-w-36 object-contain' />
							<button
								type='button'
								aria-label='Remove logo'
								onClick={() => onChange(null)}
								className='absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border bg-background text-muted-foreground hover:text-foreground'
							>
								<X className='size-2.5' />
							</button>
						</div>
					)}
					<Button variant='outline' className='rounded-full' asChild>
						<label className='cursor-pointer'>
							{value ? 'Replace' : 'Upload'}
							<input
								type='file'
								accept={STORY_LOGO_MEDIA_TYPES.join(',')}
								className='sr-only'
								onChange={(event) => {
									pick(event.target.files?.[0]);
									event.target.value = '';
								}}
							/>
						</label>
					</Button>
				</div>
			}
		/>
	);
}

function readAsDataUri(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
}

function TextRow({ label, description, value, onChange, placeholder }: RowProps<string> & { placeholder?: string }) {
	return (
		<SettingsControlRow
			label={label}
			description={description}
			control={
				<Input
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					className='w-72'
					aria-label={label}
				/>
			}
		/>
	);
}

function NumberRow({
	label,
	description,
	value,
	onChange,
	min,
	max,
	step = 1,
}: RowProps<number> & { min: number; max: number; step?: number }) {
	const [draft, setDraft] = useState(String(value));

	useEffect(() => {
		setDraft(String(value));
	}, [value]);

	const commit = (raw: string) => {
		setDraft(raw);
		const next = Number(raw);
		if (raw.trim() !== '' && !Number.isNaN(next) && next >= min && next <= max) {
			onChange(next);
		}
	};

	const clampOnBlur = () => {
		const next = Number(draft);
		if (draft.trim() === '' || Number.isNaN(next)) {
			setDraft(String(value));
			return;
		}
		onChange(Math.min(max, Math.max(min, next)));
	};

	return (
		<SettingsControlRow
			label={label}
			description={description}
			control={
				<Input
					type='number'
					value={draft}
					min={min}
					max={max}
					step={step}
					onChange={(event) => commit(event.target.value)}
					onBlur={clampOnBlur}
					className='w-28'
					aria-label={label}
				/>
			}
		/>
	);
}
