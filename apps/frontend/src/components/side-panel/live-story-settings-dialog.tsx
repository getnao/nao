import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Activity, Loader2, Type, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface LiveStorySettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	isLive: boolean;
	isLiveTextDynamic: boolean;
	cacheSchedule: string | null;
	cacheScheduleDescription: string | null;
	isUpdating: boolean;
	onSaveSettings: (settings: {
		isLive: boolean;
		isLiveTextDynamic: boolean;
		cacheSchedule: string | null;
		cacheScheduleDescription: string | null;
	}) => void;
}

const SCHEDULE_PRESETS = [
	{ value: 'manual', label: 'Manual refresh only', cron: null },
	{ value: NO_CACHE_SCHEDULE, label: 'No cache (always fresh)', cron: NO_CACHE_SCHEDULE },
	{ value: '*/5 * * * *', label: 'Every 5 minutes', cron: '*/5 * * * *' },
	{ value: '0 * * * *', label: 'Every hour', cron: '0 * * * *' },
	{ value: '0 0 * * *', label: 'Every 24 hours', cron: '0 0 * * *' },
	{ value: '0 0 * * 1', label: 'Weekly (Monday)', cron: '0 0 * * 1' },
	{ value: '0 0 1 * *', label: 'Monthly (1st)', cron: '0 0 1 * *' },
	{ value: 'custom', label: 'Custom schedule...', cron: null },
] as const;

function resolvePresetValue(cacheSchedule: string | null): string {
	if (!cacheSchedule) {
		return 'manual';
	}
	const match = SCHEDULE_PRESETS.find((p) => p.cron === cacheSchedule);
	return match ? match.value : 'custom';
}

export function LiveStorySettingsDialog({
	open,
	onOpenChange,
	isLive,
	isLiveTextDynamic,
	cacheSchedule,
	cacheScheduleDescription,
	isUpdating,
	onSaveSettings,
}: LiveStorySettingsDialogProps) {
	const [localIsLive, setLocalIsLive] = useState(isLive);
	const [localPreset, setLocalPreset] = useState(() => resolvePresetValue(cacheSchedule));
	const [localCustomCron, setLocalCustomCron] = useState(localPreset === 'custom' ? (cacheSchedule ?? '') : '');
	const [localTextBlocksDynamic, setLocalTextBlocksDynamic] = useState(isLiveTextDynamic);
	const [nlInput, setNlInput] = useState(cacheScheduleDescription ?? '');
	const [savedNlInput, setSavedNlInput] = useState(cacheScheduleDescription ?? '');

	useEffect(() => {
		if (open) {
			setLocalIsLive(isLive);
			setLocalTextBlocksDynamic(isLiveTextDynamic);
			const preset = resolvePresetValue(cacheSchedule);
			setLocalPreset(preset);
			setLocalCustomCron(preset === 'custom' ? (cacheSchedule ?? '') : '');
			setNlInput(preset === 'custom' ? (cacheScheduleDescription ?? '') : '');
			setSavedNlInput(preset === 'custom' ? (cacheScheduleDescription ?? '') : '');
		}
	}, [open, isLive, isLiveTextDynamic, cacheSchedule, cacheScheduleDescription]);

	const resolvedCron =
		localPreset === 'manual' ? null : localPreset === 'custom' ? localCustomCron || null : localPreset;
	const resolvedScheduleDescription = localIsLive && localPreset === 'custom' ? savedNlInput.trim() || null : null;

	const originalCron = cacheSchedule;
	const originalScheduleDescription = cacheScheduleDescription;
	const hasUnsavedDescriptionChanges = nlInput.trim() !== savedNlInput.trim();
	const hasChanges =
		localIsLive !== isLive ||
		localTextBlocksDynamic !== isLiveTextDynamic ||
		resolvedCron !== originalCron ||
		resolvedScheduleDescription !== originalScheduleDescription;

	const handlePresetChange = useCallback((value: string) => {
		setLocalPreset(value);
		if (value !== 'custom') {
			setLocalCustomCron('');
			setNlInput('');
			setSavedNlInput('');
		}
	}, []);

	const handleSave = useCallback(() => {
		onSaveSettings({
			isLive: localIsLive,
			isLiveTextDynamic: localIsLive ? localTextBlocksDynamic : false,
			cacheSchedule: localIsLive ? resolvedCron : null,
			cacheScheduleDescription: localIsLive ? resolvedScheduleDescription : null,
		});
		onOpenChange(false);
	}, [localIsLive, localTextBlocksDynamic, resolvedCron, resolvedScheduleDescription, onSaveSettings, onOpenChange]);

	const cronNlpMutation = useMutation(
		trpc.story.parseCronFromText.mutationOptions({
			onSuccess: (data, variables) => {
				if (data.cron) {
					setLocalCustomCron(data.cron);
					setNlInput(variables.text);
					setSavedNlInput(variables.text);
				}
			},
		}),
	);

	const handleNlConvert = useCallback(() => {
		const text = nlInput.trim();
		if (!text) {
			return;
		}
		setNlInput(text);
		cronNlpMutation.mutate({ text });
	}, [nlInput, cronNlpMutation]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Live Story Settings</DialogTitle>
					<DialogDescription>
						A live story refreshes its data from the database instead of showing a static version.
					</DialogDescription>
				</DialogHeader>

				<div className='flex flex-col gap-5'>
					<div className='flex items-center justify-between gap-4'>
						<div className='flex items-center gap-2.5'>
							<div className='flex size-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600'>
								<Activity className='size-4' />
							</div>
							<div>
								<p className='text-sm font-medium'>Live mode</p>
								<p className='text-xs text-muted-foreground'>Re-run queries to refresh data</p>
							</div>
						</div>
						<Switch checked={localIsLive} onCheckedChange={setLocalIsLive} />
					</div>

					{localIsLive && (
						<>
							<div className='flex flex-col gap-2'>
								<label className='text-sm font-medium'>Refresh schedule</label>
								<p className='text-xs text-muted-foreground'>
									How often the data should be automatically refreshed. You can always refresh
									manually using the refresh button.
								</p>
								<Select value={localPreset} onValueChange={handlePresetChange}>
									<SelectTrigger className='w-full'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{SCHEDULE_PRESETS.map((opt) => (
											<SelectItem key={opt.value} value={opt.value}>
												{opt.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{localPreset === 'custom' && (
								<div className='flex flex-col gap-3'>
									<div className='flex flex-col gap-1.5'>
										<label className='text-xs font-medium text-muted-foreground'>
											Describe in plain English
										</label>
										<div className='flex gap-2'>
											<Input
												value={nlInput}
												onChange={(e) => {
													const value = e.target.value;
													setNlInput(value);
													if (!value.trim()) {
														setSavedNlInput('');
													}
												}}
												placeholder='e.g. every weekday at 9am'
												className='h-8 text-sm flex-1'
												onKeyDown={(e) => {
													if (e.key === 'Enter') {
														handleNlConvert();
													}
												}}
											/>
											<Button
												variant='outline'
												size='sm'
												className='gap-1 shrink-0 h-8'
												onClick={handleNlConvert}
												disabled={!nlInput.trim() || cronNlpMutation.isPending}
											>
												{cronNlpMutation.isPending ? (
													<Loader2 className='size-3 animate-spin' />
												) : (
													<Wand2 className='size-3' />
												)}
												<span>Convert</span>
											</Button>
										</div>
										{cronNlpMutation.isError && (
											<p className='text-[11px] text-destructive'>
												Could not convert to cron expression. Try a different description.
											</p>
										)}
										{!cronNlpMutation.isError && (
											<p className='text-[11px] text-muted-foreground'>
												{hasUnsavedDescriptionChanges
													? 'Click Convert to update the cron expression and saved description.'
													: 'This description is saved with the cron expression.'}
											</p>
										)}
									</div>

									<div className='flex flex-col gap-1.5'>
										<label className='text-xs font-medium text-muted-foreground'>
											Or enter a cron expression
										</label>
										<Input
											value={localCustomCron}
											onChange={(e) => setLocalCustomCron(e.target.value)}
											placeholder='*/5 * * * *'
											className='h-8 text-sm font-mono'
										/>
										<p className='text-[11px] text-muted-foreground'>
											Format: minute hour day-of-month month day-of-week
										</p>
									</div>
								</div>
							)}

							<div className='flex items-center justify-between gap-4'>
								<div className='flex items-center gap-2.5'>
									<div className='flex size-8 shrink-0 items-center justify-center rounded-full bg-yellow-100 text-yellow-600'>
										<Type className='size-4' />
									</div>
									<div>
										<p className='text-sm font-medium'>Regenerate the narrative</p>
										<p className='text-xs text-muted-foreground'>
											Refresh the story text with updated numbers while keeping the current
											structure, charts, tables, and titles
										</p>
									</div>
								</div>
								<Switch checked={localTextBlocksDynamic} onCheckedChange={setLocalTextBlocksDynamic} />
							</div>
						</>
					)}
				</div>

				<DialogFooter>
					<Button variant='outline' onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={!hasChanges || isUpdating}>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
