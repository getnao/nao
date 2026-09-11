import { useMutation } from '@tanstack/react-query';
import { Sparkles, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import type {
	WebSourceFormInitial,
	WebSourceFormSubmit,
	WebSourceSchedulePreset,
} from '@/components/settings/web-source-recipe';
import { WebSourceInspector } from '@/components/settings/web-source-inspector';
import {
	DEFAULT_WEB_SOURCE_RECIPE_TEXT,
	parseWebSourceRecipe,
	recipeSummary,
	recipeToText,
	schedulePresetForCron,
	slugifyWebSourceName,
	WEB_SOURCE_SCHEDULE_PRESETS,
} from '@/components/settings/web-source-recipe';
import { WebSourceRecipeEditor } from '@/components/settings/web-source-recipe-editor';
import { WebSourceTestRecipe } from '@/components/settings/web-source-test-recipe';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/ui/error-message';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/main';

export function WebSourceForm({
	initial,
	isCreate,
	onSubmit,
	submitLabel,
	isPending,
	submitError,
	definitionHash,
}: {
	initial?: WebSourceFormInitial;
	isCreate: boolean;
	onSubmit: (value: WebSourceFormSubmit) => Promise<void>;
	submitLabel: string;
	isPending?: boolean;
	submitError?: string | null;
	definitionHash?: string;
}) {
	const [name, setName] = useState(initial?.name ?? '');
	const [slug, setSlug] = useState(initial?.slug ?? '');
	const [description, setDescription] = useState(initial?.description ?? '');
	const [cron, setCron] = useState(initial?.cron ?? '');
	const [schedulePreset, setSchedulePreset] = useState<WebSourceSchedulePreset>(schedulePresetForCron(initial?.cron));
	const [enabled, setEnabled] = useState(initial?.enabled ?? true);
	const [scheduleText, setScheduleText] = useState('');
	const [recipeText, setRecipeText] = useState(
		initial ? recipeToText(initial.recipe) : DEFAULT_WEB_SOURCE_RECIPE_TEXT,
	);
	const [localError, setLocalError] = useState<string | null>(null);
	const importInput = useRef<HTMLInputElement>(null);
	const parseCron = useMutation(trpc.webRobot.parseCronFromText.mutationOptions());

	const recipeResult = useMemo(() => parseWebSourceRecipe(recipeText), [recipeText]);
	const summary = recipeSummary(recipeResult.recipe);
	const generatedSlug = slugifyWebSourceName(name);
	const errors = [...recipeResult.errors, ...(localError ? [localError] : [])];

	const handleSchedulePreset = (preset: WebSourceSchedulePreset) => {
		setSchedulePreset(preset);
		if (preset === 'manual') {
			setCron('');
			setEnabled(true);
			return;
		}
		const selected = WEB_SOURCE_SCHEDULE_PRESETS.find((option) => option.value === preset);
		if (selected?.cron) {
			setCron(selected.cron);
		}
	};

	const handleSuggestCron = async () => {
		const text = scheduleText.trim();
		if (!text) {
			return;
		}
		const result = await parseCron.mutateAsync({ text });
		if (result.cron) {
			setCron(result.cron);
			setSchedulePreset(schedulePresetForCron(result.cron));
		}
	};

	const handleImportFile = async (file: File | undefined) => {
		if (!file) {
			return;
		}
		setLocalError(null);
		try {
			const imported = JSON.parse(await file.text()) as {
				robot?: Record<string, unknown>;
				name?: unknown;
				slug?: unknown;
				description?: unknown;
				cron?: unknown;
				enabled?: unknown;
				recipe?: unknown;
			};
			const robot = imported.robot ?? imported;
			const recipeCandidate = robot.recipe ?? ('version' in robot ? robot : undefined);
			const parsedRecipe = parseWebSourceRecipe(JSON.stringify(recipeCandidate));
			if (!parsedRecipe.recipe) {
				setLocalError(parsedRecipe.errors.join('\n'));
				return;
			}
			if (typeof robot.name === 'string') {
				setName(robot.name);
			}
			if (isCreate && typeof robot.slug === 'string') {
				setSlug(robot.slug);
			}
			if (typeof robot.description === 'string') {
				setDescription(robot.description);
			}
			const importedCron = typeof robot.cron === 'string' ? robot.cron : '';
			setCron(importedCron);
			setSchedulePreset(schedulePresetForCron(importedCron));
			setEnabled(typeof robot.enabled === 'boolean' ? robot.enabled : true);
			setRecipeText(recipeToText(parsedRecipe.recipe));
		} catch (error) {
			setLocalError(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			if (importInput.current) {
				importInput.current.value = '';
			}
		}
	};

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setLocalError(null);
		if (!name.trim()) {
			setLocalError('Name is required.');
			return;
		}
		if (!recipeResult.recipe) {
			return;
		}
		await onSubmit({
			name: name.trim(),
			slug: isCreate ? slug.trim() || undefined : undefined,
			description: description.trim() || undefined,
			cron,
			enabled: cron.trim() ? enabled : true,
			recipe: recipeResult.recipe,
		});
	};

	return (
		<form onSubmit={handleSubmit} className='flex flex-col gap-8'>
			<SettingsCard
				title='Source settings'
				description='Name, schedule, and catalogue identity for this deterministic web robot.'
				action={
					<Button type='submit' isLoading={isPending} disabled={!recipeResult.recipe}>
						{submitLabel}
					</Button>
				}
			>
				<div className='grid gap-4 md:grid-cols-2'>
					<Field label='Name'>
						<Input
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder='Deublin products'
						/>
					</Field>
					<Field
						label='Slug'
						hint={isCreate ? 'Optional. Used in the generated /datasets path.' : 'Slug is immutable.'}
					>
						<Input
							value={slug}
							onChange={(event) => setSlug(event.target.value)}
							placeholder={generatedSlug || 'deublin-products'}
							disabled={!isCreate}
						/>
					</Field>
				</div>
				<Field label='Description'>
					<Textarea
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						placeholder='Products, attributes, documents, and catalogue changes from a website.'
						className='min-h-20'
					/>
				</Field>
			</SettingsCard>

			<SettingsCard title='Schedule' description='Choose when this robot refreshes its generated dataset.'>
				<div className='grid gap-4 lg:grid-cols-[14rem_1fr_auto] lg:items-end'>
					<Field label='Frequency'>
						<Select
							value={schedulePreset}
							onValueChange={(value) => handleSchedulePreset(value as WebSourceSchedulePreset)}
						>
							<SelectTrigger size='input'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{WEB_SOURCE_SCHEDULE_PRESETS.map((preset) => (
									<SelectItem key={preset.value} value={preset.value}>
										{preset.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field label='Cron expression' hint='Server time is used for scheduled runs.'>
						<Input
							value={cron}
							onChange={(event) => {
								setCron(event.target.value);
								setSchedulePreset(schedulePresetForCron(event.target.value));
							}}
							placeholder='0 2 * * *'
							disabled={schedulePreset === 'manual'}
							className='font-mono'
						/>
					</Field>
					<div className='flex items-center gap-2 pb-0.5'>
						<Switch checked={enabled} onCheckedChange={setEnabled} disabled={!cron.trim()} />
						<span className='text-sm'>
							{cron.trim() ? (enabled ? 'Enabled' : 'Paused') : 'Manual only'}
						</span>
					</div>
				</div>
				<div className='grid gap-2 rounded-md border bg-muted/20 p-3'>
					<div className='text-xs font-medium text-muted-foreground'>Natural-language schedule</div>
					<div className='flex gap-2'>
						<Input
							value={scheduleText}
							onChange={(event) => setScheduleText(event.target.value)}
							placeholder='every weekday at 6am'
						/>
						<Button
							type='button'
							variant='secondary'
							disabled={!scheduleText.trim() || parseCron.isPending}
							isLoading={parseCron.isPending}
							onClick={handleSuggestCron}
						>
							<Sparkles className='size-3.5' />
							Suggest
						</Button>
					</div>
					{parseCron.error && <ErrorMessage message={parseCron.error.message} />}
				</div>
			</SettingsCard>

			<SettingsCard
				title='Recipe'
				description='Versioned loader, extraction, pagination, identity, and publish rules.'
				action={
					<div className='flex items-center gap-2'>
						{definitionHash && <Badge variant='outline'>hash {definitionHash.slice(0, 12)}</Badge>}
						<Button
							type='button'
							variant='ghost-muted'
							size='sm'
							onClick={() => importInput.current?.click()}
						>
							<Upload className='size-3.5' />
							Import JSON
						</Button>
						<input
							ref={importInput}
							type='file'
							accept='application/json,.json'
							className='hidden'
							onChange={(event) => void handleImportFile(event.target.files?.[0])}
						/>
					</div>
				}
			>
				<WebSourceRecipeEditor value={recipeText} onChange={setRecipeText} />
				{summary && (
					<div className='flex flex-wrap gap-2'>
						<Badge variant='secondary'>v{recipeResult.recipe?.version}</Badge>
						<Badge variant='outline'>{summary.stageCount} stages</Badge>
						{summary.sourceTypes.map((type) => (
							<Badge key={type} variant='outline'>
								{type}
							</Badge>
						))}
						{summary.allowedHosts.map((host) => (
							<Badge key={host} variant='secondary'>
								{host}
							</Badge>
						))}
					</div>
				)}
				{recipeResult.errors.length > 0 && <ErrorMessage message={recipeResult.errors.join('\n')} />}
			</SettingsCard>

			<WebSourceTestRecipe recipe={recipeResult.recipe} validationErrors={recipeResult.errors} />
			<WebSourceInspector
				key={recipeResult.recipe?.stages[0]?.source.url ?? 'no-source'}
				recipe={recipeResult.recipe}
			/>

			{(submitError || errors.length > 0) && (
				<ErrorMessage message={[submitError, ...errors].filter(Boolean).join('\n')} />
			)}
			<div className='flex justify-end'>
				<Button type='submit' isLoading={isPending} disabled={!recipeResult.recipe}>
					{submitLabel}
				</Button>
			</div>
		</form>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<label className='grid gap-1.5 text-sm'>
			<span className='text-xs font-medium text-muted-foreground'>{label}</span>
			{children}
			{hint && <span className='text-xs text-muted-foreground'>{hint}</span>}
		</label>
	);
}
