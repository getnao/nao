import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Activity, Loader2, Sparkles, Wand2 } from 'lucide-react';
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
	cacheSchedule: string | null;
	refreshText: boolean;
	isUpdating: boolean;
	onSaveSettings: (settings: { isLive: boolean; cacheSchedule: string | null; refreshText: boolean }) => void;
}

const SCHEDULE_PRESETS = [
	{ value: 'manual', label: 'Manual refresh only', cron: null },
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
	cacheSchedule,
	refreshText,
	isUpdating,
	onSaveSettings,
}: LiveStorySettingsDialogProps) {
	const [localIsLive, setLocalIsLive] = useState(isLive);
	const [localPreset, setLocalPreset] = useState(() => resolvePresetValue(cacheSchedule));
	const [localCustomCron, setLocalCustomCron] = useState(localPreset === 'custom' ? (cacheSchedule ?? '') : '');
	const [localRefreshText, setLocalRefreshText] = useState(refreshText);
	const [nlInput, setNlInput] = useState('');

	useEffect(() => {
		if (open) {
			setLocalIsLive(isLive);
			const preset = resolvePresetValue(cacheSchedule);
			setLocalPreset(preset);
			setLocalCustomCron(preset === 'custom' ? (cacheSchedule ?? '') : '');
			setLocalRefreshText(refreshText);
			setNlInput('');
		}
	}, [open, isLive, cacheSchedule, refreshText]);

	const resolvedCron =
		localPreset === 'manual' ? null : localPreset === 'custom' ? localCustomCron || null : localPreset;

	const originalCron = cacheSchedule;
	const hasChanges = localIsLive !== isLive || resolvedCron !== originalCron || localRefreshText !== refreshText;

	const handlePresetChange = useCallback((value: string) => {
		setLocalPreset(value);
		if (value !== 'custom') {
			setLocalCustomCron('');
			setNlInput('');
		}
	}, []);

	const handleSave = useCallback(() => {
		onSaveSettings({
			isLive: localIsLive,
			cacheSchedule: localIsLive ? resolvedCron : null,
			refreshText: localIsLive ? localRefreshText : false,
		});
		onOpenChange(false);
	}, [localIsLive, resolvedCron, localRefreshText, onSaveSettings, onOpenChange]);

	const cronNlpMutation = useMutation(
		trpc.story.parseCronFromText.mutationOptions({
			onSuccess: (data) => {
				if (data.cron) {
					setLocalCustomCron(data.cron);
					setNlInput('');
				}
			},
		}),
	);

	const handleNlConvert = useCallback(() => {
		if (!nlInput.trim()) {
			return;
		}
		cronNlpMutation.mutate({ text: nlInput.trim() });
	}, [nlInput, cronNlpMutation]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className='sm:max-w-md'>
				<DialogHeader>
					<DialogTitle>Live Story Settings</DialogTitle>
					<DialogDescription>
						A live story refreshes its data from the database instead of showing a static snapshot.
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
											Cron expression
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

									<div className='flex flex-col gap-1.5'>
										<label className='text-xs font-medium text-muted-foreground'>
											Or describe in plain English
										</label>
										<div className='flex gap-2'>
											<Input
												value={nlInput}
												onChange={(e) => setNlInput(e.target.value)}
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
									</div>
								</div>
							)}

							<div className='flex items-center justify-between gap-4'>
								<div className='flex items-center gap-2.5'>
									<div className='flex size-8 items-center justify-center rounded-full bg-violet-100 text-violet-600'>
										<Sparkles className='size-4' />
									</div>
									<div>
										<p className='text-sm font-medium'>Refresh text analysis</p>
										<p className='text-xs text-muted-foreground'>
											Use AI to update the story text when data refreshes
										</p>
									</div>
								</div>
								<Switch checked={localRefreshText} onCheckedChange={setLocalRefreshText} />
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
