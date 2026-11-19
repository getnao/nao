import { pluralize } from '@nao/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { TestModelSelection, TestSchedule } from '@nao/backend/test-run';
import type { TestDefinition } from '@/components/settings/test-run-types';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import type { ScheduleFrequency, SchedulePick } from '@/lib/test-schedule-cron';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { describeModelSelection } from '@/hooks/use-test-run-settings';
import { createLocalStorage } from '@/lib/local-storage';
import {
	buildScheduleCron,
	describeScheduleCron,
	isCompleteSchedulePick,
	NEW_SCHEDULE_PICK,
	parseScheduleCron,
	WEEKDAYS,
} from '@/lib/test-schedule-cron';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const FREQUENCIES: { value: ScheduleFrequency; label: string }[] = [
	{ value: 'hourly', label: 'Every hour' },
	{ value: 'daily', label: 'Every day' },
	{ value: 'weekdays', label: 'Weekdays' },
	{ value: 'weekly', label: 'Every week' },
	{ value: 'custom', label: 'Custom cron' },
];
const TIMED_FREQUENCIES: ScheduleFrequency[] = ['daily', 'weekdays', 'weekly'];
const NEW_SCHEDULE = 'new';
const schedulesOpenStorage = createLocalStorage('nao-test-schedules-open', false);

interface ScheduledModels {
	models: TestModelSelection[];
	attempts: number;
}

interface TestSchedulesProps {
	/** The models and attempts picked above, which a new schedule runs with. */
	settings: TestRunSettings;
	tests: TestDefinition[];
}

/**
 * The part of the model picker that runs the picked models on a schedule, against the production context: the
 * schedules saved in the app, which it adds, edits, pauses and removes, and the ones of nao_config.yaml, which it only
 * lists.
 * It stays folded until opened, to leave the picker to the models, and stays as it was left.
 */
export function TestSchedules({ settings, tests }: TestSchedulesProps) {
	const queryClient = useQueryClient();
	const schedules = useQuery(trpc.testRun.listSchedules.queryOptions());
	const [isOpen, setIsOpen] = useLocalStorage(schedulesOpenStorage);
	const [editedId, setEditedId] = useState<string | null>(null);
	const activeCount = schedules.data?.schedules.filter((schedule) => schedule.isEnabled).length ?? 0;
	const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.testRun.listSchedules.queryKey() });
	const setEnabled = useMutation(trpc.testRun.setScheduleEnabled.mutationOptions({ onSuccess: refresh }));
	const deleteSchedule = useMutation(trpc.testRun.deleteSchedule.mutationOptions({ onSuccess: refresh }));

	return (
		<section aria-label='Schedules' className='border-t'>
			<button
				type='button'
				aria-expanded={isOpen}
				onClick={() => setIsOpen(!isOpen)}
				className='flex w-full cursor-pointer items-center gap-1.5 px-3 py-2 text-left hover:bg-accent/50'
			>
				<ChevronRight
					className={cn('size-3.5 text-muted-foreground transition-transform', isOpen && 'rotate-90')}
				/>
				Schedules
				<span className='ml-auto text-muted-foreground'>
					{activeCount > 0 ? `${activeCount} active` : 'None'}
				</span>
			</button>
			{isOpen && (
				<>
					<div className='flex items-center justify-between gap-3 px-3 pb-2'>
						<span className='text-muted-foreground'>Run these models on production, on a schedule.</span>
						{editedId === null && (
							<Button
								type='button'
								size='pill'
								variant='secondary'
								onClick={() => setEditedId(NEW_SCHEDULE)}
							>
								<Plus className='size-3.5' />
								Schedule
							</Button>
						)}
					</div>
					<ul className='flex flex-col empty:hidden'>
						{schedules.data?.schedules.map((schedule) =>
							schedule.id === editedId ? (
								<li key={schedule.id} className='border-b last:border-b-0'>
									<ScheduleForm
										schedule={schedule}
										settings={settings}
										tests={tests}
										timezone={schedules.data.timezone}
										onClose={() => setEditedId(null)}
										onSaved={refresh}
									/>
								</li>
							) : (
								<ScheduleRow
									key={schedule.id}
									schedule={schedule}
									onEdit={() => setEditedId(schedule.id)}
									onEnabledChange={(isEnabled) => setEnabled.mutate({ id: schedule.id, isEnabled })}
									onDelete={() => deleteSchedule.mutate({ id: schedule.id })}
								/>
							),
						)}
					</ul>
					{editedId === NEW_SCHEDULE && (
						<ScheduleForm
							settings={settings}
							tests={tests}
							timezone={schedules.data?.timezone ?? 'server time'}
							onClose={() => setEditedId(null)}
							onSaved={refresh}
						/>
					)}
				</>
			)}
		</section>
	);
}

/** How many schedules run the tests, shown in the button of the model picker. */
export function ActiveScheduleCount() {
	const schedules = useQuery(trpc.testRun.listSchedules.queryOptions());
	const activeCount = schedules.data?.schedules.filter((schedule) => schedule.isEnabled).length ?? 0;
	if (activeCount === 0) {
		return null;
	}
	return (
		<span
			className='flex items-center gap-1 border-l pl-1.5 text-emerald-600 dark:text-emerald-400'
			title={`${activeCount} ${pluralize('schedule', activeCount)} run the tests`}
		>
			<CalendarClock className='size-3.5' />
			{activeCount}
		</span>
	);
}

function ScheduleRow({
	schedule,
	onEdit,
	onEnabledChange,
	onDelete,
}: {
	schedule: TestSchedule;
	onEdit: () => void;
	onEnabledChange: (isEnabled: boolean) => void;
	onDelete: () => void;
}) {
	const name = describeScheduleCron(schedule.cron);
	const scheduledRun = describeScheduledRun(schedule);
	return (
		<li className='flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50'>
			<CalendarClock
				className={cn(
					'size-3.5 shrink-0',
					schedule.isEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
				)}
			/>
			<span className='flex min-w-0 flex-1 flex-col'>
				<span className={cn('truncate', name === schedule.cron && 'font-mono')}>{name}</span>
				<span className='truncate text-muted-foreground' title={scheduledRun}>
					{scheduledRun}
				</span>
			</span>
			{schedule.source === 'config' ? (
				<span className='shrink-0 font-mono text-[10px] text-muted-foreground' title='Change it in the file'>
					nao_config.yaml
				</span>
			) : (
				<>
					<Switch
						aria-label={`Run the tests ${name}`}
						checked={schedule.isEnabled}
						onCheckedChange={onEnabledChange}
					/>
					<Button
						type='button'
						size='icon-xs'
						variant='ghost'
						className='text-muted-foreground'
						aria-label={`Edit the schedule ${name}`}
						onClick={onEdit}
					>
						<Pencil />
					</Button>
					<Button
						type='button'
						size='icon-xs'
						variant='ghost'
						className='-ml-1.5 text-muted-foreground hover:text-destructive'
						aria-label={`Remove the schedule ${name}`}
						onClick={onDelete}
					>
						<Trash2 />
					</Button>
				</>
			)}
		</li>
	);
}

/**
 * Adds a schedule, which runs the models of the picker, or edits the given one, which keeps its models until the ones
 * of the picker are taken.
 */
function ScheduleForm({
	schedule,
	settings,
	tests,
	timezone,
	onClose,
	onSaved,
}: {
	schedule?: TestSchedule;
	settings: TestRunSettings;
	tests: TestDefinition[];
	timezone: string;
	onClose: () => void;
	onSaved: () => Promise<void>;
}) {
	const formRef = useRef<HTMLFormElement>(null);
	const pickerModels: ScheduledModels = { models: settings.models, attempts: settings.attempts };
	const [pick, setPick] = useState(() => (schedule ? parseScheduleCron(schedule.cron) : NEW_SCHEDULE_PICK));
	const [pickedTags, setPickedTags] = useState(schedule?.tags ?? []);
	const [scheduled, setScheduled] = useState<ScheduledModels>(() => ({
		models: schedule?.models ?? pickerModels.models,
		attempts: schedule?.attempts ?? pickerModels.attempts,
	}));
	const tags = [...new Set([...tests.flatMap((test) => test.tags), ...pickedTags])].sort();
	const testCount = tests.filter(
		(test) => pickedTags.length === 0 || test.tags.some((tag) => pickedTags.includes(tag)),
	).length;
	const mutationOptions = {
		onSuccess: async () => {
			await onSaved();
			onClose();
		},
	};
	const createSchedule = useMutation(trpc.testRun.createSchedule.mutationOptions(mutationOptions));
	const updateSchedule = useMutation(trpc.testRun.updateSchedule.mutationOptions(mutationOptions));
	const error = createSchedule.error ?? updateSchedule.error;
	const isSaving = createSchedule.isPending || updateSchedule.isPending;
	const scheduledLabel = describeModelSelection(scheduled.models, scheduled.attempts);
	const pickerLabel = describeModelSelection(pickerModels.models, pickerModels.attempts);

	/** Once the popover has made room for the form, as it would otherwise stay cut by the popover's edge. */
	useEffect(() => {
		const frame = requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: 'nearest' }));
		return () => cancelAnimationFrame(frame);
	}, []);

	const save = () => {
		const settingsToSave = { cron: buildScheduleCron(pick), tags: pickedTags, ...scheduled };
		if (schedule) {
			updateSchedule.mutate({ id: schedule.id, ...settingsToSave });
		} else {
			createSchedule.mutate(settingsToSave);
		}
	};

	const update = (changes: Partial<SchedulePick>) => {
		setPick((current) => ({ ...current, ...changes }));
	};

	const toggleTag = (tag: string) => {
		setPickedTags((current) =>
			current.includes(tag) ? current.filter((other) => other !== tag) : [...current, tag],
		);
	};

	return (
		<form
			ref={formRef}
			aria-label={schedule ? 'Edit the schedule' : 'New schedule'}
			className='flex flex-col gap-2 border-t bg-muted/40 px-3 py-2.5'
			onSubmit={(event) => {
				event.preventDefault();
				save();
			}}
		>
			<div className='flex flex-wrap items-center gap-1.5'>
				<Select value={pick.frequency} onValueChange={(frequency: ScheduleFrequency) => update({ frequency })}>
					<SelectTrigger size='sm' className='bg-background text-xs' aria-label='Frequency'>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{FREQUENCIES.map((frequency) => (
							<SelectItem key={frequency.value} value={frequency.value} className='text-xs'>
								{frequency.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{pick.frequency === 'weekly' && (
					<Select
						value={String(pick.weekday)}
						onValueChange={(weekday) => update({ weekday: Number(weekday) })}
					>
						<SelectTrigger size='sm' className='bg-background text-xs' aria-label='Day'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{WEEKDAYS.map((weekday, index) => (
								<SelectItem key={weekday} value={String(index)} className='text-xs'>
									on {weekday}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}
				{TIMED_FREQUENCIES.includes(pick.frequency) && (
					<>
						<span className='text-muted-foreground'>at</span>
						<Input
							type='time'
							value={pick.time}
							onChange={(event) => update({ time: event.target.value })}
							aria-label='Time'
							className='h-6 w-24 bg-background px-2 text-xs md:text-xs'
						/>
					</>
				)}
				{pick.frequency === 'custom' && (
					<Input
						value={pick.cron}
						onChange={(event) => update({ cron: event.target.value })}
						placeholder='0 6 * * 1-5'
						aria-label='Cron expression'
						className='h-6 w-32 bg-background px-2 font-mono text-xs md:text-xs'
					/>
				)}
				{pick.frequency !== 'hourly' && <span className='text-muted-foreground'>{timezone}</span>}
			</div>
			{tags.length > 0 && (
				<div className='flex flex-wrap items-center gap-1'>
					<span className='mr-0.5 text-muted-foreground'>Only the tests tagged</span>
					{tags.map((tag) => (
						<button
							key={tag}
							type='button'
							aria-pressed={pickedTags.includes(tag)}
							onClick={() => toggleTag(tag)}
							className='cursor-pointer rounded-full border bg-background px-2 leading-5 text-muted-foreground hover:text-foreground aria-pressed:border-foreground/40 aria-pressed:bg-accent aria-pressed:text-foreground'
						>
							{tag}
						</button>
					))}
				</div>
			)}
			{!isSameScheduledModels(scheduled, pickerModels) && (
				<button
					type='button'
					className='cursor-pointer self-start text-muted-foreground underline-offset-4 hover:text-foreground hover:underline'
					onClick={() => setScheduled(pickerModels)}
				>
					Use the models of the picker: {pickerLabel}
				</button>
			)}
			<div className='flex items-center gap-2'>
				{error ? (
					<span className='min-w-0 flex-1 text-destructive'>{error.message}</span>
				) : (
					<span className='min-w-0 flex-1 truncate text-muted-foreground'>
						{pickedTags.length === 0 && 'All '}
						{testCount} {pluralize('test', testCount)} on {scheduledLabel}
					</span>
				)}
				<Button type='button' size='pill' variant='ghost-muted' onClick={onClose}>
					Cancel
				</Button>
				<Button
					type='submit'
					size='pill'
					disabled={isSaving || scheduled.models.length === 0 || !isCompleteSchedulePick(pick)}
				>
					{schedule ? 'Save' : 'Add schedule'}
				</Button>
			</div>
		</form>
	);
}

function isSameScheduledModels(scheduled: ScheduledModels, other: ScheduledModels): boolean {
	return listScheduledModelKeys(scheduled).join() === listScheduledModelKeys(other).join();
}

function listScheduledModelKeys({ models, attempts }: ScheduledModels): string[] {
	const modelKeys = models.map(
		(model) => `${model.provider}:${model.modelId}:${(model.reasoningEfforts ?? []).join('+')}`,
	);
	return [String(attempts), ...modelKeys];
}

/** Which tests a schedule runs on which models, and when next. */
function describeScheduledRun(schedule: TestSchedule): string {
	const tests = schedule.tags.length > 0 ? schedule.tags.join(', ') : 'All tests';
	const models = schedule.models
		? describeModelSelection(schedule.models, schedule.attempts ?? 1)
		: 'the project models';
	const nextRun = schedule.nextRunAt ? `next ${formatRunTime(schedule.nextRunAt)}` : 'paused';
	return [tests, models, nextRun].join(' · ');
}

function formatRunTime(date: Date | string): string {
	return new Date(date).toLocaleString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	});
}
