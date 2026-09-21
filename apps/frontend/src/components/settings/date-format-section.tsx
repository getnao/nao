import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
	DATE_FORMAT_PRESET_PATTERNS,
	DEFAULT_DATE_FORMAT_SETTINGS,
	formatDateValue,
	SUPPORTED_DATE_FORMAT_TOKENS,
} from '@nao/shared/date';
import type { DateFormatPreset } from '@nao/shared/date';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';

interface DateFormatSectionProps {
	isAdmin: boolean;
}

interface PresetOption {
	value: DateFormatPreset;
	label: string;
	description: string;
}

const PRESET_OPTIONS: PresetOption[] = [
	{
		value: 'european',
		label: `European (${DATE_FORMAT_PRESET_PATTERNS.european})`,
		description: 'Day before month, slash-separated.',
	},
	{
		value: 'american',
		label: `American (${DATE_FORMAT_PRESET_PATTERNS.american})`,
		description: 'Month before day, slash-separated.',
	},
	{
		value: 'iso',
		label: `ISO 8601 (${DATE_FORMAT_PRESET_PATTERNS.iso})`,
		description: 'Sortable, year-first format.',
	},
	{
		value: 'custom',
		label: 'Custom',
		description: 'Provide your own pattern using the supported tokens below.',
	},
];

const PRESET_SELECT_ID = 'date-format-preset';
const SAMPLE_DATE = '2024-03-15';

export function DateFormatSection({ isAdmin }: DateFormatSectionProps) {
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

	const preset: DateFormatPreset = displaySettings.data?.dateFormat?.preset ?? DEFAULT_DATE_FORMAT_SETTINGS.preset;
	const savedCustom = displaySettings.data?.dateFormat?.customFormat ?? '';

	const [customDraft, setCustomDraft] = useState(savedCustom);
	useEffect(() => setCustomDraft(savedCustom), [savedCustom]);

	const handlePresetChange = (next: string) => {
		const nextPreset = next as DateFormatPreset;
		updateDisplaySettings.mutate({
			dateFormat: {
				preset: nextPreset,
				customFormat: nextPreset === 'custom' ? customDraft.trim() || undefined : undefined,
			},
		});
	};

	const handleCustomSave = () => {
		const trimmed = customDraft.trim();
		if (trimmed === savedCustom) {
			return;
		}
		updateDisplaySettings.mutate({
			dateFormat: {
				preset: 'custom',
				customFormat: trimmed || undefined,
			},
		});
	};

	// When the user blurs the custom input by clicking on the preset selector
	// (or one of its options) the Select also issues an update mutation.
	// Skipping the blur save here avoids a race where the two writes can land
	// out of order and leave the project pinned to "custom" instead of the
	// preset the user actually picked.
	const handleCustomBlur = (event: React.FocusEvent<HTMLInputElement>) => {
		const next = event.relatedTarget as HTMLElement | null;
		const isMovingToPresetSelect =
			next?.id === PRESET_SELECT_ID || Boolean(next?.closest('[data-radix-popper-content-wrapper]'));
		if (isMovingToPresetSelect) {
			return;
		}
		handleCustomSave();
	};

	const effectiveSettings =
		preset === 'custom' ? { preset, customFormat: customDraft.trim() || undefined } : { preset };
	const preview = formatDateValue(SAMPLE_DATE, effectiveSettings);
	const presetLabel = PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? '';

	const isMutating = updateDisplaySettings.isPending;
	const isDisabled = !isAdmin || isMutating;

	return (
		<SettingsCard
			title='Date format'
			description='Choose how dates are displayed in charts, tooltips and query result tables for this project.'
		>
			<div className='grid gap-2'>
				<label htmlFor={PRESET_SELECT_ID} className='text-sm font-medium text-foreground'>
					Format
				</label>
				<Select value={preset} onValueChange={handlePresetChange} disabled={isDisabled}>
					<SelectTrigger id={PRESET_SELECT_ID} className='w-full'>
						<SelectValue>{presetLabel}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{PRESET_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value} className='h-auto items-start py-1.5'>
								<div className='flex flex-col gap-0.5'>
									<span>{option.label}</span>
									<span className='text-xs text-muted-foreground'>{option.description}</span>
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{preset === 'custom' && (
				<div className='grid gap-2'>
					<label htmlFor='date-format-custom' className='text-sm font-medium text-foreground'>
						Custom pattern
					</label>
					<Input
						id='date-format-custom'
						value={customDraft}
						placeholder='e.g. DD MMM YYYY'
						onChange={(event) => setCustomDraft(event.target.value)}
						onBlur={handleCustomBlur}
						onKeyDown={(event) => {
							if (event.key === 'Enter') {
								event.preventDefault();
								handleCustomSave();
							}
						}}
						disabled={isDisabled}
						className='font-mono'
					/>
					<div className='space-y-1 text-xs text-muted-foreground'>
						<p>
							Wrap literal text in square brackets (e.g.{' '}
							<code className='font-mono'>[on] DD/MM/YYYY</code>). Supported tokens:
						</p>
						<ul className='grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2'>
							{SUPPORTED_DATE_FORMAT_TOKENS.map((token) => (
								<li key={token.token}>
									<code className='font-mono text-foreground'>{token.token}</code>{' '}
									<span>{token.description}</span>
								</li>
							))}
						</ul>
					</div>
				</div>
			)}

			<div className='flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2'>
				<span className='text-xs text-muted-foreground'>
					Preview for <code className='font-mono'>{SAMPLE_DATE}</code>
				</span>
				<span className='font-mono text-sm font-medium'>{preview}</span>
			</div>
		</SettingsCard>
	);
}
