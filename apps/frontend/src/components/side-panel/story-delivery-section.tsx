import { NO_CACHE_SCHEDULE } from '@nao/shared';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Send, Slack, Wand2 } from 'lucide-react';
import type { NotificationChannel } from '@nao/shared/types';

import { MemberPicker } from '@/components/share-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export interface StoryDeliveryHandle {
	save: () => Promise<void>;
}

export interface StoryDeliveryStatus {
	dirty: boolean;
	valid: boolean;
}

interface StoryDeliverySectionProps {
	chatId: string;
	storySlug: string;
	open: boolean;
	refreshCron: string | null;
	onStatusChange: (status: StoryDeliveryStatus) => void;
}

type RecipientMode = 'all' | 'specific';
type DeliveryTiming = 'after-refresh' | 'custom-schedule';

const CUSTOM_PRESET = 'custom';
const DEFAULT_PRESET = '0 8 * * *';

const STANDARD_PRESETS: { value: string; label: string }[] = [
	{ value: '0 * * * *', label: 'Every hour' },
	{ value: '0 8 * * *', label: 'Every day at 8am' },
	{ value: '0 8 * * 1', label: 'Every Monday at 8am' },
	{ value: '0 8 1 * *', label: 'Monthly (1st at 8am)' },
];

const SCHEDULE_OPTIONS: { value: string; label: string }[] = [
	...STANDARD_PRESETS,
	{ value: CUSTOM_PRESET, label: 'Custom schedule…' },
];

export const StoryDeliverySection = forwardRef<StoryDeliveryHandle, StoryDeliverySectionProps>(
	function StoryDeliverySection({ chatId, storySlug, open, refreshCron, onStatusChange }, ref) {
		const queryClient = useQueryClient();
		const delivery = useQuery({ ...trpc.story.getDelivery.queryOptions({ chatId, storySlug }), enabled: open });
		const recipientsQuery = useQuery({
			...trpc.story.listDeliveryRecipients.queryOptions({ chatId, storySlug }),
			enabled: open,
		});
		const slackConfigQuery = useQuery({
			...trpc.project.getSlackConfig.queryOptions(),
			enabled: open,
		});
		const shareQuery = useQuery({
			...trpc.storyShare.getSharedStoryInfo.queryOptions({ chatId, storySlug }),
			enabled: open,
		});
		const isShared = Boolean(shareQuery.data?.shareId);

		const [enabled, setEnabled] = useState(false);
		const [timing, setTiming] = useState<DeliveryTiming>('after-refresh');
		const [preset, setPreset] = useState<string>(DEFAULT_PRESET);
		const [customCron, setCustomCron] = useState('');
		const [nlInput, setNlInput] = useState('');
		const [savedNlInput, setSavedNlInput] = useState('');
		const [nlConvertFailed, setNlConvertFailed] = useState(false);
		const [recipientMode, setRecipientMode] = useState<RecipientMode>('all');
		const [selected, setSelected] = useState<Set<string>>(new Set());
		const [emailEnabled, setEmailEnabled] = useState(true);
		const [slackEnabled, setSlackEnabled] = useState(false);
		const [search, setSearch] = useState('');

		// Seed the form from server state only once per dialog open. Re-syncing on every
		// refetch (e.g. after a mutation or window refocus) would discard unsaved edits.
		const initializedRef = useRef(false);
		useEffect(() => {
			if (!open) {
				initializedRef.current = false;
				return;
			}
			if (initializedRef.current || !delivery.data) {
				return;
			}
			initializedRef.current = true;
			setEnabled(delivery.data.enabled);
			const initialTiming = resolveInitialTiming(delivery.data.cron, delivery.data.enabled, refreshCron);
			setTiming(initialTiming);
			const scheduleValue =
				initialTiming === 'custom-schedule' ? resolveScheduleValue(delivery.data.cron) : DEFAULT_PRESET;
			setPreset(scheduleValue);
			setCustomCron(scheduleValue === CUSTOM_PRESET ? (delivery.data.cron ?? '') : '');
			const desc = delivery.data.scheduleDescription ?? '';
			setNlInput(scheduleValue === CUSTOM_PRESET ? desc : '');
			setSavedNlInput(scheduleValue === CUSTOM_PRESET ? desc : '');
			setRecipientMode((delivery.data.recipientMode as RecipientMode) ?? 'all');
			setSelected(new Set(delivery.data.recipientUserIds));
			setEmailEnabled(delivery.data.channels.includes('email'));
			setSlackEnabled(delivery.data.channels.includes('slack'));
		}, [open, delivery.data]); // eslint-disable-line react-hooks/exhaustive-deps

		const updateDelivery = useMutation(
			trpc.story.updateDelivery.mutationOptions({
				onSuccess: () => {
					queryClient.invalidateQueries({
						queryKey: trpc.story.getDelivery.queryKey({ chatId, storySlug }),
					});
					// Enabling delivery can auto-share the story, so keep sharing state in sync.
					queryClient.invalidateQueries({
						queryKey: trpc.storyShare.getSharedStoryInfo.queryKey({ chatId, storySlug }),
					});
					queryClient.invalidateQueries({ queryKey: trpc.storyShare.list.queryKey() });
				},
			}),
		);

		const cronNlpMutation = useMutation(
			trpc.story.parseCronFromText.mutationOptions({
				onSuccess: (data, variables) => {
					if (data.cron) {
						setCustomCron(data.cron);
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
			setNlConvertFailed(false);
			cronNlpMutation.mutate({ text });
		}, [nlInput, cronNlpMutation]);

		const handleEnabledChange = useCallback((next: boolean) => {
			setEnabled(next);
			if (next) {
				setTiming('after-refresh');
				setEmailEnabled(true);
				setSlackEnabled(false);
				setRecipientMode('all');
			}
		}, []);

		const handleCustomCronChange = useCallback((value: string) => {
			setCustomCron(value);
			setSavedNlInput('');
		}, []);

		const handlePresetChange = useCallback((value: string) => {
			setPreset(value);
			if (value !== CUSTOM_PRESET) {
				setCustomCron('');
				setNlInput('');
				setSavedNlInput('');
				setNlConvertFailed(false);
			}
		}, []);

		const filteredMembers = useMemo(() => {
			const members = recipientsQuery.data ?? [];
			const term = search.trim().toLowerCase();
			if (!term) {
				return members;
			}
			return members.filter(
				(member) => member.name.toLowerCase().includes(term) || member.email.toLowerCase().includes(term),
			);
		}, [recipientsQuery.data, search]);

		const resolvedCron =
			timing === 'after-refresh'
				? hasMirrorableRefresh(refreshCron)
					? refreshCron
					: null
				: preset === CUSTOM_PRESET
					? customCron.trim() || null
					: preset;
		const resolvedScheduleDescription =
			timing === 'custom-schedule' && preset === CUSTOM_PRESET ? savedNlInput.trim() || null : null;

		const channels = useMemo(() => {
			const result: NotificationChannel[] = [];
			if (emailEnabled) {
				result.push('email');
			}
			if (slackEnabled) {
				result.push('slack');
			}
			return result;
		}, [emailEnabled, slackEnabled]);

		const isSlackConfigured = Boolean(slackConfigQuery.data?.projectConfig);

		const valid =
			!enabled ||
			(channels.length > 0 &&
				(recipientMode === 'all' || selected.size > 0) &&
				(timing === 'after-refresh' || Boolean(resolvedCron)));

		const dirty = useMemo(() => {
			const initial = delivery.data;
			if (!initial) {
				return enabled;
			}
			const initialSelected = new Set(initial.recipientUserIds);
			const sameRecipients =
				initialSelected.size === selected.size && [...selected].every((id) => initialSelected.has(id));
			return (
				initial.enabled !== enabled ||
				(initial.cron ?? null) !== resolvedCron ||
				initial.scheduleDescription !== resolvedScheduleDescription ||
				(initial.recipientMode ?? 'all') !== recipientMode ||
				!sameRecipients ||
				initial.channels.includes('email') !== emailEnabled ||
				initial.channels.includes('slack') !== slackEnabled
			);
		}, [
			delivery.data,
			enabled,
			resolvedCron,
			resolvedScheduleDescription,
			recipientMode,
			selected,
			emailEnabled,
			slackEnabled,
		]);

		useEffect(() => {
			onStatusChange({ dirty, valid });
		}, [dirty, valid, onStatusChange]);

		const toggleUser = (userId: string) => {
			setSelected((prev) => {
				const next = new Set(prev);
				if (next.has(userId)) {
					next.delete(userId);
				} else {
					next.add(userId);
				}
				return next;
			});
		};

		useImperativeHandle(
			ref,
			() => ({
				save: async () => {
					if (!dirty) {
						return;
					}
					await updateDelivery.mutateAsync({
						chatId,
						storySlug,
						enabled,
						cron: enabled ? resolvedCron : null,
						scheduleDescription: enabled ? resolvedScheduleDescription : null,
						channels: channels.length > 0 ? channels : ['email'],
						recipientMode,
						recipientUserIds: recipientMode === 'all' ? [] : [...selected],
					});
				},
			}),
			[
				dirty,
				chatId,
				storySlug,
				enabled,
				resolvedCron,
				resolvedScheduleDescription,
				channels,
				recipientMode,
				selected,
				updateDelivery,
			],
		);

		return (
			<section className='flex flex-col gap-4'>
				<div className='flex items-center justify-between gap-4'>
					<div className='flex items-center gap-2.5'>
						<div className='flex size-8 shrink-0 items-center justify-center rounded-full'>
							<Send className='size-4' />
						</div>
						<div className='flex flex-col gap-1'>
							<p className='text-sm font-semibold'>Scheduled delivery</p>
							<p className='text-xs text-muted-foreground'>
								Automatically send the latest version of this story.
							</p>
						</div>
					</div>
					<Switch checked={enabled} onCheckedChange={handleEnabledChange} />
				</div>

				{enabled && (
					<div className='flex flex-col gap-5 pl-10'>
						<div className='flex flex-col gap-3'>
							<TimingOption
								active={timing === 'after-refresh'}
								label='Whenever the story refreshes'
								onClick={() => setTiming('after-refresh')}
							/>
							<div className='flex flex-col gap-2'>
								<TimingOption
									active={timing === 'custom-schedule'}
									label='On a schedule'
									onClick={() => setTiming('custom-schedule')}
								/>
								{timing === 'custom-schedule' && (
									<div className='pl-[26px]'>
										<DeliverySchedulePicker
											preset={preset}
											customCron={customCron}
											nlInput={nlInput}
											savedNlInput={savedNlInput}
											nlConvertPending={cronNlpMutation.isPending}
											nlConvertError={cronNlpMutation.isError || nlConvertFailed}
											onPresetChange={handlePresetChange}
											onCustomCronChange={handleCustomCronChange}
											onNlInputChange={(v) => {
												setNlInput(v);
												setNlConvertFailed(false);
												if (!v.trim()) {
													setSavedNlInput('');
												}
											}}
											onNlConvert={handleNlConvert}
										/>
									</div>
								)}
							</div>
						</div>

						<div className='flex flex-row gap-4 items-center'>
							<label className='text-sm font-semibold'>Channels</label>
							<div className='flex gap-2 flex-1'>
								<ChannelCard
									icon={<Mail className='size-4' />}
									label='Email'
									active={emailEnabled}
									onClick={() => setEmailEnabled((v) => !v)}
								/>
								{isSlackConfigured ? (
									<ChannelCard
										icon={<Slack className='size-4' />}
										label='Slack'
										active={slackEnabled}
										onClick={() => setSlackEnabled((v) => !v)}
									/>
								) : (
									<SimpleTooltip content='Connect Slack in your project settings to deliver stories to Slack.'>
										<span className='flex-1 cursor-not-allowed'>
											<ChannelCard
												icon={<Slack className='size-4' />}
												label='Slack'
												active={false}
												disabled
												onClick={() => {}}
												className='pointer-events-none w-full'
											/>
										</span>
									</SimpleTooltip>
								)}
							</div>
						</div>

						{!isShared && (
							<div className='rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground'>
								This story isn't shared yet. Scheduling delivery will share it with your project so
								recipients can open it.
							</div>
						)}

						<div className='flex flex-col gap-2'>
							<div className='flex flex-row items-center gap-4'>
								<label className='text-sm font-semibold'>Recipients</label>
								<Select
									value={recipientMode}
									onValueChange={(value) => setRecipientMode(value as RecipientMode)}
								>
									<SelectTrigger className='flex-1 bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent className='bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
										<SelectItem value='all'>
											{isShared ? 'Everyone with access' : 'All project members'}
										</SelectItem>
										<SelectItem value='specific'>Specific members</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{recipientMode === 'specific' && (
								<MemberPicker
									members={filteredMembers}
									selectedUserIds={selected}
									isLoading={recipientsQuery.isLoading}
									search={search}
									onSearchChange={setSearch}
									onToggleUser={toggleUser}
								/>
							)}
						</div>
					</div>
				)}
			</section>
		);
	},
);

function TimingOption({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
	return (
		<button type='button' onClick={onClick} className='flex w-full items-start gap-2.5 text-left cursor-pointer'>
			<span
				className={cn(
					'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
					active ? 'border-primary' : 'border-muted-foreground/40',
				)}
			>
				{active && <span className='size-2 rounded-full bg-primary' />}
			</span>
			<div className='flex flex-col gap-0.5'>
				<span className='text-sm font-medium text-foreground'>{label}</span>
			</div>
		</button>
	);
}

function DeliverySchedulePicker({
	preset,
	customCron,
	nlInput,
	savedNlInput,
	nlConvertPending,
	nlConvertError,
	onPresetChange,
	onCustomCronChange,
	onNlInputChange,
	onNlConvert,
}: {
	preset: string;
	customCron: string;
	nlInput: string;
	savedNlInput: string;
	nlConvertPending: boolean;
	nlConvertError: boolean;
	onPresetChange: (value: string) => void;
	onCustomCronChange: (value: string) => void;
	onNlInputChange: (value: string) => void;
	onNlConvert: () => void;
}) {
	const hasUnsavedDescriptionChanges = nlInput.trim() !== savedNlInput.trim();

	return (
		<div className='flex flex-col gap-2'>
			<Select value={preset} onValueChange={onPresetChange}>
				<SelectTrigger className='w-full bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
					<SelectValue />
				</SelectTrigger>
				<SelectContent className='bg-panel [&_svg]:text-foreground! [&_svg]:opacity-100!'>
					{SCHEDULE_OPTIONS.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>

			{preset === CUSTOM_PRESET && (
				<div className='flex flex-col gap-3'>
					<div className='flex flex-col gap-1.5'>
						<label className='text-sm font-medium text-muted-foreground'>Describe in plain English</label>
						<div className='flex gap-2'>
							<Input
								value={nlInput}
								onChange={(e) => onNlInputChange(e.target.value)}
								placeholder='e.g. every weekday at 9am'
								className='h-8 text-sm flex-1 bg-panel'
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										onNlConvert();
									}
								}}
							/>
							<Button
								variant='outline'
								size='sm'
								className='gap-1 shrink-0 h-8 rounded-full'
								onClick={onNlConvert}
								disabled={!nlInput.trim() || nlConvertPending}
							>
								{nlConvertPending ? (
									<Loader2 className='size-3 animate-spin' />
								) : (
									<Wand2 className='size-3' />
								)}
								<span>Convert</span>
							</Button>
						</div>
						{nlConvertError && (
							<p className='text-[11px] text-destructive'>
								Could not convert to cron expression. Try a different description.
							</p>
						)}
						{!nlConvertError && (
							<p className='text-[11px] text-muted-foreground'>
								{hasUnsavedDescriptionChanges
									? 'Click Convert to update the cron expression.'
									: 'This description is saved with the schedule.'}
							</p>
						)}
					</div>

					<div className='flex flex-col gap-1.5'>
						<label className='text-sm font-medium text-muted-foreground'>Or enter a cron expression</label>
						<Input
							value={customCron}
							onChange={(e) => onCustomCronChange(e.target.value)}
							placeholder='0 8 * * *'
							className='h-8 text-sm font-mono bg-panel'
						/>
						<p className='text-[11px] text-muted-foreground'>
							Format: minute hour day-of-month month day-of-week
						</p>
					</div>
				</div>
			)}
		</div>
	);
}

function ChannelCard({
	icon,
	label,
	active,
	disabled,
	onClick,
	className,
}: {
	icon: React.ReactNode;
	label: string;
	active: boolean;
	disabled?: boolean;
	onClick: () => void;
	className?: string;
}) {
	return (
		<button
			type='button'
			onClick={onClick}
			disabled={disabled}
			className={cn(
				'flex-1 flex flex-row items-center justify-center gap-2 rounded-full border py-1 px-2 transition-colors cursor-pointer',
				active
					? 'border-primary'
					: disabled
						? 'border-border opacity-40 cursor-not-allowed'
						: 'border-border hover:border-muted-foreground/30 hover:bg-muted/50',
				className,
			)}
		>
			<div className={cn('text-foreground', active ? 'text-primary' : '')}>{icon}</div>
			<span className='text-sm font-medium text-foreground'>{label}</span>
		</button>
	);
}

function hasMirrorableRefresh(refreshCron: string | null): refreshCron is string {
	return refreshCron !== null && refreshCron !== NO_CACHE_SCHEDULE;
}

function resolveInitialTiming(cron: string | null, enabled: boolean, refreshCron: string | null): DeliveryTiming {
	if (cron === null) {
		return enabled ? 'after-refresh' : 'custom-schedule';
	}
	return hasMirrorableRefresh(refreshCron) && cron === refreshCron ? 'after-refresh' : 'custom-schedule';
}

function resolveScheduleValue(cron: string | null): string {
	if (cron === null) {
		return DEFAULT_PRESET;
	}
	return STANDARD_PRESETS.some((p) => p.value === cron) ? cron : CUSTOM_PRESET;
}
