import { useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, CornerDownLeft, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import type { DragEndEvent } from '@dnd-kit/core';
import { useMessageQueueStore } from '@/hooks/use-message-queue-store';
import { useChatId } from '@/hooks/use-chat-id';
import { cn } from '@/lib/utils';
import { messageQueueStore } from '@/stores/chat-message-queue';

interface ChatInputMessageQueueProps {
	onEditMessage?: (text: string) => void;
	onSubmitNow?: (messageId: string) => Promise<void>;
}

export const ChatInputMessageQueue = ({ onEditMessage, onSubmitNow }: ChatInputMessageQueueProps) => {
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
		<div className='relative flex flex-col w-full mx-auto border border-input/50 rounded-2xl rounded-b-none -mb-4 pb-4 bg-muted/50 overflow-hidden'>
			<button
				type='button'
				onClick={() => setIsExpanded(!isExpanded)}
				className='flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none'
			>
				<ChevronDown className={cn('size-3 transition-transform duration-200', !isExpanded && '-rotate-90')} />
				<span>{queuedMessages.length} Queued</span>
			</button>

			{isExpanded && (
				<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
					<SortableContext items={queuedMessages.map((m) => m.id)} strategy={verticalListSortingStrategy}>
						<div className='flex flex-col px-3'>
							{queuedMessages.map((qm, idx) => (
								<SortableQueuedMessageRow
									key={qm.id}
									chatId={chatId}
									messageId={qm.id}
									text={qm.text}
									isFirst={idx === 0}
									isDraggable={queuedMessages.length > 1}
									onEdit={onEditMessage}
									onSubmitNow={onSubmitNow}
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
	messageId,
	text,
	isFirst,
	isDraggable,
	onEdit,
	onSubmitNow,
}: {
	chatId: string | undefined;
	messageId: string;
	text: string;
	isFirst: boolean;
	isDraggable: boolean;
	onEdit?: (text: string) => void;
	onSubmitNow?: (messageId: string) => Promise<void>;
}) {
	const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
		id: messageId,
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
			{isDraggable && (
				<button
					ref={setActivatorNodeRef}
					type='button'
					className='shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground touch-none'
					{...attributes}
					{...listeners}
				>
					<GripVertical className='size-3.5' />
				</button>
			)}

			<span className='truncate flex-1 min-w-0'>{text}</span>

			<div className='flex items-center shrink-0'>
				{isFirst && (
					<span className='group-hover:hidden flex items-center gap-1 text-xs text-muted-foreground/50'>
						<CornerDownLeft className='size-3' />
						<span>to submit</span>
					</span>
				)}

				<div className='hidden group-hover:flex items-center'>
					<Button variant='ghost-muted' size='icon-xs' type='button' onClick={() => onSubmitNow?.(messageId)}>
						<CornerDownLeft className='size-3' />
					</Button>
					<Button
						variant='ghost-muted'
						size='icon-xs'
						type='button'
						onClick={() => {
							messageQueueStore.remove(chatId, messageId);
							onEdit?.(text);
						}}
					>
						<Pencil className='size-3' />
					</Button>
					<Button
						variant='ghost-muted'
						size='icon-xs'
						type='button'
						className='hover:text-destructive'
						onClick={() => messageQueueStore.remove(chatId, messageId)}
					>
						<Trash2 className='size-3' />
					</Button>
				</div>
			</div>
		</div>
	);
}
