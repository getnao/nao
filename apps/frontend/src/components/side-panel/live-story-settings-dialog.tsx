import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Activity, Loader2, Wand2 } from 'lucide-react';
import { StoryDeliverySection } from './story-delivery-section';
import type { StoryDeliveryHandle, StoryDeliveryStatus } from './story-delivery-section';
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
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { trpc } from '@/main';

interface LiveStorySettingsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	chatId: string;
	storySlug: string;
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
	}) => void | Promise<void>;
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
	chatId,
	storySlug,
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
	const [nlConvertFailed, setNlConvertFailed] = useState(false);
	const deliveryRef = useRef<StoryDeliveryHandle>(null);
	const [deliveryStatus, setDeliveryStatus] = useState<StoryDeliveryStatus>({ dirty: false, valid: true });
	const [isSaving, setIsSaving] = useState(false);
	const handleDeliveryStatusChange = useCallback((status: StoryDeliveryStatus) => setDeliveryStatus(status), []);
	const isBusy = isUpdating || isSaving;

	const handleOpenChange = useCallback(
		(next: boolean) => {
			if (!next && isSaving) {
				return;
			}
			onOpenChange(next);
		},
		[isSaving, onOpenChange],
	);

	useEffect(() => {
		if (open) {
			setLocalIsLive(isLive);
			setLocalTextBlocksDynamic(isLiveTextDynamic);
			const preset = resolvePresetValue(cacheSchedule);
			setLocalPreset(preset);
			setLocalCustomCron(preset === 'custom' ? (cacheSchedule ?? '') : '');
			setNlInput(preset === 'custom' ? (cacheScheduleDescription ?? '') : '');
			setSavedNlInput(preset === 'custom' ? (cacheScheduleDescription ?? '') : '');
			setNlConvertFailed(false);
		}
	}, [open, isLive, isLiveTextDynamic, cacheSchedule, cacheScheduleDescription]);

	const resolvedCron =
		localPreset === 'manual' ? null : localPreset === 'custom' ? localCustomCron || null : localPreset;
	const resolvedScheduleDescription = localIsLive && localPreset === 'custom' ? savedNlInput.trim() || null : null;

	const originalCron = cacheSchedule;
	const originalScheduleDescription = cacheScheduleDescription;
	const hasUnsavedDescriptionChanges = nlInput.trim() !== savedNlInput.trim();
	const hasLiveChanges =
		localIsLive !== isLive ||
		localTextBlocksDynamic !== isLiveTextDynamic ||
		resolvedCron !== originalCron ||
		resolvedScheduleDescription !== originalScheduleDescription;
	const hasChanges = hasLiveChanges || deliveryStatus.dirty;

	const handlePresetChange = useCallback((value: string) => {
		setLocalPreset(value);
		if (value !== 'custom') {
			setLocalCustomCron('');
			setNlInput('');
			setSavedNlInput('');
			setNlConvertFailed(false);
		}
	}, []);

	const handleSave = useCallback(async () => {
		setIsSaving(true);
		try {
			if (hasLiveChanges) {
				await onSaveSettings({
					isLive: localIsLive,
					isLiveTextDynamic: localIsLive ? localTextBlocksDynamic : false,
					cacheSchedule: localIsLive ? resolvedCron : null,
					cacheScheduleDescription: localIsLive ? resolvedScheduleDescription : null,
				});
			}
			if (localIsLive && deliveryStatus.dirty) {
				await deliveryRef.current?.save();
			}
			onOpenChange(false);
		} catch (error) {
			console.error('Failed to save story settings', error);
		} finally {
			setIsSaving(false);
		}
	}, [
		hasLiveChanges,
		localIsLive,
		localTextBlocksDynamic,
		resolvedCron,
		resolvedScheduleDescription,
		deliveryStatus.dirty,
		onSaveSettings,
		onOpenChange,
	]);

	const cronNlpMutation = useMutation(
		trpc.story.parseCronFromText.mutationOptions({
			onSuccess: (data, variables) => {
				if (data.cron) {
					setLocalCustomCron(data.cron);
					setNlInput(variables.text);
					setSavedNlInput(variables.text);
					setNlConvertFailed(false);
				} else {
					setNlConvertFailed(true);
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
		setNlConvertFailed(false);
		cronNlpMutation.mutate({ text });
	}, [nlInput, cronNlpMutation]);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className='sm:max-w-md max-h-[85vh] overflow-y-auto'>
				<DialogHeader className='gap-4'>
					<DialogTitle>Live Story Settings</DialogTitle>
					<DialogDescription className='text-sm text-muted-foreground font-medium'>
						Automatically keep this story up to date and optionally send the latest version to your team.
					</DialogDescription>
				</DialogHeader>

				<fieldset disabled={isBusy} className='flex flex-col gap-5 border-0 m-0 p-0 min-w-0'>
					<section className='flex flex-col gap-4'>
						<div className='flex items-center justify-between gap-4'>
							<div className='flex items-center gap-2.5'>
								<div className='flex size-8 items-center justify-center rounded-full'>
									<Activity className='size-4' />
								</div>
								<div className='flex flex-col gap-1'>
									<p className='text-sm font-semibold'>Live</p>
									<p className='text-xs text-muted-foreground'>Re-run queries to refresh data.</p>
								</div>
							</div>
							<Switch checked={localIsLive} onCheckedChange={setLocalIsLive} />
						</div>

						{localIsLive && (
							<div className='flex flex-col gap-4 pl-10'>
								<div className='flex flex-col gap-2'>
									<label className='text-sm font-semibold'>Refresh schedule</label>
									<p className='text-xs text-muted-foreground'>
										How often the data should be automatically refreshed. You can always refresh
										manually using the refresh button.
									</p>
									<Select value={localPreset} onValueChange={handlePresetChange}>
										<SelectTrigger className='w-full bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent className='bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
											{SCHEDULE_PRESETS.map((opt) => (
												<SelectItem key={opt.value} value={opt.value}>
													{opt.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>

									{localPreset === 'custom' && (
										<div className='flex flex-col gap-3'>
											<div className='flex flex-col gap-1.5'>
												<label className='text-sm font-medium text-muted-foreground'>
													Describe in plain English
												</label>
												<div className='flex gap-2'>
													<Input
														value={nlInput}
														onChange={(e) => {
															const value = e.target.value;
															setNlInput(value);
															setNlConvertFailed(false);
															if (!value.trim()) {
																setSavedNlInput('');
															}
														}}
														placeholder='e.g. every weekday at 9am'
														className='h-8 text-sm flex-1 bg-panel'
														onKeyDown={(e) => {
															if (e.key === 'Enter') {
																handleNlConvert();
															}
														}}
													/>
													<Button
														variant='outline'
														size='sm'
														className='gap-1 shrink-0 h-8 rounded-full'
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
												{(cronNlpMutation.isError || nlConvertFailed) && (
													<p className='text-[11px] text-destructive'>
														Could not convert to cron expression. Try a different
														description.
													</p>
												)}
												{!(cronNlpMutation.isError || nlConvertFailed) && (
													<p className='text-[11px] text-muted-foreground'>
														{hasUnsavedDescriptionChanges
															? 'Click Convert to update the cron expression and saved description.'
															: 'This description is saved with the cron expression.'}
													</p>
												)}
											</div>

											<div className='flex flex-col gap-1.5'>
												<label className='text-sm font-medium text-muted-foreground'>
													Or enter a cron expression
												</label>
												<Input
													value={localCustomCron}
													onChange={(e) => setLocalCustomCron(e.target.value)}
													placeholder='*/5 * * * *'
													className='h-8 text-sm font-mono bg-panel'
												/>
												<p className='text-[11px] text-muted-foreground'>
													Format: minute hour day-of-month month day-of-week
												</p>
											</div>
										</div>
									)}
								</div>

								<div className='flex items-center justify-between gap-4'>
									<div className='flex items-center gap-2.5'>
										<div className='flex flex-col gap-1'>
											<p className='text-sm font-semibold'>Regenerate the narrative</p>
											<p className='text-xs text-muted-foreground'>
												Refresh the story text with updated numbers while keeping the current
												structure, charts, tables, and titles
											</p>
										</div>
									</div>
									<Switch
										checked={localTextBlocksDynamic}
										onCheckedChange={setLocalTextBlocksDynamic}
									/>
								</div>
							</div>
						)}
					</section>

					{localIsLive && (
						<>
							<Separator />

							<StoryDeliverySection
								ref={deliveryRef}
								chatId={chatId}
								storySlug={storySlug}
								open={open}
								refreshCron={resolvedCron}
								onStatusChange={handleDeliveryStatusChange}
							/>
						</>
					)}
				</fieldset>

				<DialogFooter>
					<Button
						variant='outline'
						className='rounded-full'
						onClick={() => onOpenChange(false)}
						disabled={isBusy}
					>
						Cancel
					</Button>
					<Button
						variant='primary-gradient'
						className='rounded-full'
						onClick={handleSave}
						disabled={!hasChanges || (localIsLive && !deliveryStatus.valid) || isBusy}
					>
						{isBusy && <Loader2 className='size-3.5 animate-spin' />}
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
