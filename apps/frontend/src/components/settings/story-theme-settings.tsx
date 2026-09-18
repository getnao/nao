import {
	DEFAULT_STORY_THEME,
	HEX_COLOR,
	MAX_CHART_SERIES_COLORS,
	MIN_CHART_SERIES_COLORS,
	sameTheme,
	storyThemeSchema,
} from '@nao/shared/story-theme';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Eye, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { StoryTheme } from '@nao/shared/story-theme';

import type { InspirationOutcome } from '@/components/settings/story-theme-inspiration';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { useInvalidateStoryTheme, useStoryThemeEditor } from '@/components/settings/story-theme-editor-context';
import { StoryThemeInspiration } from '@/components/settings/story-theme-inspiration';
import { StoryThemePreviewPanel } from '@/components/settings/story-theme-preview';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { SettingsControlRow } from '@/components/ui/settings-toggle-row';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useSidePanel } from '@/contexts/side-panel';
import { trpc } from '@/main';

const BORDER_WIDTHS = [0, 1, 2, 3, 4];

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
	const { theme, setTheme } = useStoryThemeEditor();
	const [error, setError] = useState<string | null>(null);
	const [inspiration, setInspiration] = useState<InspirationOutcome | null>(null);
	const openPreview = usePreviewPanel();
	const invalidate = useInvalidateStoryTheme();

	const saved = state.data?.theme ?? null;
	const enabled = state.data?.enabled ?? false;
	const baseline = saved ?? DEFAULT_STORY_THEME;

	useEffect(() => {
		if (state.data && theme === null) {
			setTheme(state.data.theme ?? DEFAULT_STORY_THEME);
		}
	}, [state.data, theme, setTheme]);

	const onError = (mutationError: { message: string }) => setError(mutationError.message);
	const revertPending = () => {
		setTheme(baseline);
		setInspiration(null);
	};

	const save = useMutation({
		...trpc.storyTheme.save.mutationOptions(),
		onSuccess: async () => {
			setInspiration(null);
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
	const isDirty = !sameTheme(theme, baseline);
	const isDefault = sameTheme(theme, DEFAULT_STORY_THEME);
	const controlsDisabled = isReadOnly || isPending;

	const validate = (): StoryTheme | null => {
		const result = storyThemeSchema.safeParse(theme);
		if (!result.success) {
			setError(result.error.issues[0]?.message ?? 'Invalid theme.');
			return null;
		}
		setError(null);
		return result.data;
	};

	const update = <Group extends keyof StoryTheme>(group: Group, patch: Partial<StoryTheme[Group]>) =>
		setTheme((current) => (current ? { ...current, [group]: { ...current[group], ...patch } } : current));

	return (
		<>
			<SettingsCard
				title='Custom story theme'
				description={
					isReadOnly
						? 'Colours, fonts, blocks, tables and charts applied to every custom story in this project. Only admins can change this.'
						: 'Colours, fonts, blocks, tables and charts applied to every custom story in this project.'
				}
				action={openPreview.button}
			>
				<SettingsControlRow
					id='story-theme-enabled'
					label='Apply to custom stories'
					description={
						saved
							? 'Turn off to fall back to the classic nao look without losing the saved theme.'
							: 'Saving a theme turns this on.'
					}
					control={
						<Switch
							id='story-theme-enabled'
							checked={enabled}
							onCheckedChange={(next) => setEnabled.mutate({ enabled: next })}
							disabled={!saved || controlsDisabled}
						/>
					}
				/>
			</SettingsCard>

			{isAdmin && (
				<StoryThemeInspiration
					disabled={controlsDisabled}
					outcome={inspiration}
					onGenerated={(label, result) => {
						setInspiration({ label });
						setTheme(result.theme);
						openPreview.show();
					}}
					onDismiss={() => setInspiration(null)}
				/>
			)}

			<LockedFieldset disabled={controlsDisabled}>
				<SettingsCard title='Colours' description='Page, text and accent.' divide>
					<ColorRow
						label='Page background'
						description='Behind the whole story.'
						value={theme.surfaces.page}
						onChange={(page) => update('surfaces', { page })}
					/>
					<ColorRow
						label='Recessed surfaces'
						description='Inactive controls and hover states.'
						value={theme.surfaces.sunken}
						onChange={(sunken) => update('surfaces', { sunken })}
					/>
					<ColorRow
						label='Heading colour'
						description='Titles and KPI values.'
						value={theme.text.headingColor}
						onChange={(headingColor) => update('text', { headingColor })}
					/>
					<ColorRow
						label='Body colour'
						description='Paragraphs, lists and table cells.'
						value={theme.text.bodyColor}
						onChange={(bodyColor) => update('text', { bodyColor })}
					/>
					<ColorRow
						label='Muted colour'
						description='Axis ticks, captions and helper text.'
						value={theme.text.mutedColor}
						onChange={(mutedColor) => update('text', { mutedColor })}
					/>
					<ColorRow
						label='Accent'
						description='Links, active filters and selected states.'
						value={theme.accent.color}
						onChange={(color) => update('accent', { color })}
					/>
					<ColorRow
						label='Text on accent'
						description='Text placed on the accent colour.'
						value={theme.accent.ink}
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
						value={theme.text.headingFont}
						onChange={(headingFont) => update('text', { headingFont })}
						placeholder={DEFAULT_STORY_THEME.text.headingFont}
					/>
					<TextRow
						label='Body font'
						description='Paragraphs, lists and everything else.'
						value={theme.text.bodyFont}
						onChange={(bodyFont) => update('text', { bodyFont })}
						placeholder={DEFAULT_STORY_THEME.text.bodyFont}
					/>
					<TextRow
						label='Font CSS URL'
						description='One Google Fonts (or Bunny / Adobe) CSS link that loads both fonts above. Skip this for Arial, Helvetica and other system fonts.'
						value={theme.text.fontStylesheets[0] ?? ''}
						onChange={(value) => update('text', { fontStylesheets: value.trim() ? [value.trim()] : [] })}
						placeholder='https://fonts.googleapis.com/css2?family=Inter'
					/>
				</SettingsCard>

				<SettingsCard title='Text size' description='Scale of headings and body text.' divide>
					<NumberRow
						label='Heading size'
						description='Multiplier on heading sizes.'
						value={theme.text.headingScale}
						onChange={(headingScale) => update('text', { headingScale })}
						min={0.8}
						max={1.4}
						step={0.05}
					/>
					<NumberRow
						label='Body size'
						description='Paragraph size in px.'
						value={theme.text.bodySize}
						onChange={(bodySize) => update('text', { bodySize })}
						min={13}
						max={20}
					/>
					<NumberRow
						label='Line height'
						description='Paragraph line height.'
						value={theme.text.lineHeight}
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
						value={theme.block.background}
						onChange={(background) => update('block', { background })}
					/>
					<ColorRow
						label='Border colour'
						description='Also used for rules and inputs.'
						value={theme.block.borderColor}
						onChange={(borderColor) => update('block', { borderColor })}
					/>
					<BorderWidthRow
						value={theme.block.borderWidth}
						onChange={(borderWidth) => update('block', { borderWidth })}
					/>
					<NumberRow
						label='Corner radius'
						description='In px, from square to very round.'
						value={theme.block.radius}
						onChange={(radius) => update('block', { radius })}
						min={0}
						max={28}
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
						value={theme.table.background}
						onChange={(background) => update('table', { background })}
					/>
					<ColorRow
						label='Header background'
						description='Column headers and the row-number column.'
						value={theme.table.headerBackground}
						onChange={(headerBackground) => update('table', { headerBackground })}
					/>
					<ColorRow
						label='Header text'
						description='Column labels.'
						value={theme.table.headerText}
						onChange={(headerText) => update('table', { headerText })}
					/>
					<ColorRow
						label='Border colour'
						description='Frame, header rule and cell dividers.'
						value={theme.table.borderColor}
						onChange={(borderColor) => update('table', { borderColor })}
					/>
					<BorderWidthRow
						description='Of the frame; corners follow the block radius.'
						value={theme.table.borderWidth}
						onChange={(borderWidth) => update('table', { borderWidth })}
					/>
					<SettingsControlRow
						id='story-theme-table-striped'
						label='Striped rows'
						description='Tint every other row with the header background.'
						control={
							<Switch
								id='story-theme-table-striped'
								checked={theme.table.stripedRows}
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
								value={theme.charts.series}
								onChange={(series) => update('charts', { series })}
							/>
						}
					/>
					<ColorRow
						label='Grid lines'
						description='Behind every chart.'
						value={theme.charts.grid}
						onChange={(grid) => update('charts', { grid })}
					/>
					<NumberRow
						label='Bar radius'
						description='Corner radius on vertical bars, in px. Horizontal bars stay pill-shaped.'
						value={theme.charts.barRadius}
						onChange={(barRadius) => update('charts', { barRadius })}
						min={0}
						max={12}
					/>
				</SettingsCard>
			</LockedFieldset>

			{isAdmin && (
				<div className='sticky bottom-0 -mx-4 -mb-6 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:-mx-8 md:-mb-8 md:px-8'>
					<div className='flex items-center gap-2'>
						<Button
							variant='outline'
							className='rounded-full text-destructive hover:text-destructive'
							onClick={() => {
								setTheme(DEFAULT_STORY_THEME);
								setInspiration(null);
							}}
							disabled={isPending || isDefault}
						>
							Reset to nao defaults
						</Button>
						{error && <p className='text-xs text-destructive'>{error}</p>}
					</div>
					<div className='flex items-center gap-2'>
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
									save.mutate({ theme: valid });
								}
							}}
							disabled={!isDirty}
						>
							{save.isPending ? 'Saving…' : 'Save'}
						</Button>
					</div>
				</div>
			)}
		</>
	);
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
		<Button variant='primary-gradient' className='rounded-full' onClick={show}>
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
				<div key={index} className='relative'>
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
