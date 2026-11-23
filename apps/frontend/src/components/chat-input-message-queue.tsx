import { useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, CornerDownLeft, GripVertical, Navigation, Pencil, Trash2 } from 'lucide-react';
import { Button, ChatButton } from './ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import type { DragEndEvent } from '@dnd-kit/core';
import type { QueuedMessage } from '@/types/chat-message-queue';
import { useMessageQueueStore } from '@/hooks/use-message-queue-store';
import { useChatId } from '@/hooks/use-chat-id';
import { useIsModifierHeld } from '@/hooks/use-is-modifier-held';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { getShortcutLabel } from '@/lib/keyboard-shortcuts';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';
import { canSteer, messageQueueStore } from '@/stores/chat-message-queue';

/** While the agent runs, Enter queues the message and the swap shortcut steers, unless the user swapped them. */
export const steerOnEnterStorage = createLocalStorage<boolean>('nao-steer-on-enter', false);

interface ChatInputMessageQueueProps {
	onEditMessage?: (message: QueuedMessage) => void;
	onSubmitNow?: (messageId: string) => Promise<void>;
	onSteer?: (messageId: string) => Promise<void>;
}

export const ChatInputMessageQueue = ({ onEditMessage, onSubmitNow, onSteer }: ChatInputMessageQueueProps) => {
	const chatId = useChatId();
	const { queuedMessages } = useMessageQueueStore(chatId);
	const [isExpanded, setIsExpanded] = useState(true);

	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	);

	if (!queuedMessages.length) {
		return null;
	}

	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) {
			return;
		}
		const fromIndex = queuedMessages.findIndex((m) => m.id === active.id);
		const toIndex = queuedMessages.findIndex((m) => m.id === over.id);
		if (fromIndex !== -1 && toIndex !== -1) {
			messageQueueStore.reorder(chatId, fromIndex, toIndex);
		}
	};

	return (
		<div className='relative flex flex-col w-full mx-auto border border-input/50 rounded-2xl rounded-b-none -mb-4 pb-4 bg-panel/50 overflow-hidden'>
			<button
				type='button'
				onClick={() => setIsExpanded(!isExpanded)}
				className='flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none'
			>
				<ChevronDown className={cn('size-3 transition-transform duration-200', !isExpanded && '-rotate-90')} />
				<span>{describeQueue(queuedMessages)}</span>
			</button>

			{isExpanded && (
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
					<SortableContext items={queuedMessages.map((m) => m.id)} strategy={verticalListSortingStrategy}>
						<div className='flex flex-col px-3'>
							{queuedMessages.map((qm, idx) => (
								<SortableQueuedMessageRow
									key={qm.id}
									chatId={chatId}
									message={qm}
									isFirst={idx === 0}
									isDraggable={queuedMessages.length > 1}
									onEdit={onEditMessage}
									onSubmitNow={onSubmitNow}
									onSteer={onSteer}
								/>
							))}
						</div>
					</SortableContext>
				</DndContext>
			)}
		</div>
	);
};

function SortableQueuedMessageRow({
	chatId,
	message,
	isFirst,
	isDraggable,
	onEdit,
	onSubmitNow,
	onSteer,
}: {
	chatId: string | undefined;
	message: QueuedMessage;
	isFirst: boolean;
	isDraggable: boolean;
	onEdit?: (message: QueuedMessage) => void;
	onSubmitNow?: (messageId: string) => Promise<void>;
	onSteer?: (messageId: string) => Promise<void>;
}) {
	const { id: messageId, text, steer } = message;
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id: messageId,
		disabled: steer,
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				'flex w-full items-center gap-1 text-sm group h-8 rounded-md',
				!isFirst && 'text-muted-foreground/75',
				isDragging && 'opacity-50',
			)}
		>
			{steer && <Navigation className='size-3.5 shrink-0 text-primary animate-pulse' />}

			{isDraggable && !steer && (
				<button
					ref={setActivatorNodeRef}
					type='button'
					className='shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground touch-none'
					{...attributes}
					{...listeners}
				>
					<GripVertical className={cn('size-3.5', isFirst && 'text-primary')} />
				</button>
			)}

			<span className='truncate flex-1 min-w-0'>{text}</span>

			{steer ? (
				<span className='shrink-0 text-xs text-muted-foreground/50'>
					Steering · read after the running tools
				</span>
			) : (
				<QueuedMessageActions
					isFirst={isFirst}
					onSubmitNow={() => onSubmitNow?.(messageId)}
					onSteer={canSteer(message) ? () => onSteer?.(messageId) : undefined}
					onEdit={() => {
						messageQueueStore.remove(chatId, messageId);
						onEdit?.(message);
					}}
					onRemove={() => messageQueueStore.remove(chatId, messageId)}
				/>
			)}
		</div>
	);
}

function QueuedMessageActions({
	isFirst,
	onSubmitNow,
	onSteer,
	onEdit,
	onRemove,
}: {
	isFirst: boolean;
	onSubmitNow: () => void;
	onSteer?: () => void;
	onEdit: () => void;
	onRemove: () => void;
}) {
	return (
		<div className='flex items-center shrink-0'>
			{isFirst && (
				<span className='group-hover:hidden flex items-center gap-1 text-xs text-muted-foreground/50'>
					<CornerDownLeft className='size-3' />
					<span>to submit</span>
				</span>
			)}

			<div className='hidden group-hover:flex items-center'>
				{onSteer && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant='ghost-muted'
								size='icon-xs'
								className='rounded-full'
								type='button'
								aria-label='Steer now'
								onClick={onSteer}
							>
								<Navigation className='size-3' />
							</Button>
						</TooltipTrigger>
						<TooltipContent side='top'>Steer now: read after the running tools</TooltipContent>
					</Tooltip>
				)}
				<Button
					variant='ghost-muted'
					size='icon-xs'
					className='rounded-full'
					type='button'
					onClick={onSubmitNow}
				>
					<CornerDownLeft className='size-3' />
				</Button>
				<Button variant='ghost-muted' size='icon-xs' className='rounded-full' type='button' onClick={onEdit}>
					<Pencil className='size-3' />
				</Button>
				<Button
					variant='ghost-muted'
					size='icon-xs'
					className='hover:text-destructive rounded-full'
					type='button'
					onClick={onRemove}
				>
					<Trash2 className='size-3' />
				</Button>
			</div>
		</div>
	);
}

/** The send button while the agent runs: its icon shows whether sending steers or queues, and holding ⌘ swaps them. */
export function SteerOrQueueButton({
	disabled,
	isDraftSteerable,
	onSend,
}: {
	disabled: boolean;
	/** Only plain text can steer: a draft with attachments, citations or mentions is always queued. */
	isDraftSteerable: boolean;
	onSend: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
	const [steerOnEnter] = useLocalStorage(steerOnEnterStorage);
	const isModifierHeld = useIsModifierHeld();
	const steers = isDraftSteerable && steerOnEnter !== isModifierHeld;
	const swapShortcut = getShortcutLabel('swap-steer-queue');
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<ChatButton
					showStop={false}
					disabled={disabled}
					onClick={onSend}
					type='button'
					aria-label={steers ? 'Steer' : 'Queue'}
					icon={steers ? <Navigation className='size-3.5' /> : undefined}
				/>
			</TooltipTrigger>
			<TooltipContent side='top' className='max-w-60'>
				{!isDraftSteerable
					? 'Queue: sent after the answer. Only text messages can steer the running agent.'
					: steerOnEnter
						? `Steer: read after the running tools. ${swapShortcut} to queue it for after the answer.`
						: `Queue: sent after the answer. ${swapShortcut} to steer, read after the running tools.`}
			</TooltipContent>
		</Tooltip>
	);
}

function describeQueue(messages: QueuedMessage[]): string {
	const steeringCount = messages.filter((message) => message.steer).length;
	const queuedCount = messages.length - steeringCount;
	return [steeringCount && `${steeringCount} steering`, queuedCount && `${queuedCount} queued`]
		.filter(Boolean)
		.join(' · ');
}
