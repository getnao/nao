import { Store } from './abstract-store';
import type { NewQueuedMessage, QueuedMessage } from '@/types/chat-message-queue';
import { NEW_CHAT_ID } from '@/lib/ai';

export const MAX_QUEUE_SIZE = 5;

class MessageQueueStore extends Store<Map<string, QueuedMessage[]>> {
	protected state = new Map<string, QueuedMessage[]>();

	enqueue = (agentId: string | undefined, msg: NewQueuedMessage): QueuedMessage | undefined => {
		agentId ??= NEW_CHAT_ID;
		const agentQueue = this.state.get(agentId);
		if (agentQueue && agentQueue.length >= MAX_QUEUE_SIZE) {
			return undefined;
		}

		const newMessage: QueuedMessage = {
			id: crypto.randomUUID(),
			...msg,
		};

		this.state.set(agentId, insertInQueue(agentQueue ?? [], newMessage));
		this.notify();
		return newMessage;
	};

	steer = (agentId: string | undefined, messageId: string): QueuedMessage | undefined => {
		agentId ??= NEW_CHAT_ID;
		const agentQueue = this.state.get(agentId);
		const message = agentQueue?.find((m) => m.id === messageId);
		if (!agentQueue || !message) {
			return undefined;
		}
		const steeredMessage = { ...message, steer: true };
		const rest = agentQueue.filter((m) => m.id !== messageId);
		this.state.set(agentId, insertInQueue(rest, steeredMessage));
		this.notify();
		return steeredMessage;
	};

	/** Turns steers the agent did not pick up back into queued messages. */
	unsteer = (agentId: string | undefined, messageId?: string) => {
		agentId ??= NEW_CHAT_ID;
		const agentQueue = this.state.get(agentId);
		if (!agentQueue?.some((m) => m.steer && (!messageId || m.id === messageId))) {
			return;
		}
		this.state.set(
			agentId,
			agentQueue.map((m) => (!messageId || m.id === messageId ? { ...m, steer: false } : m)),
		);
		this.notify();
	};

	dequeue = (agentId: string): QueuedMessage | undefined => {
		const agentQueue = this.state.get(agentId);
		if (!agentQueue || agentQueue.length === 0) {
			return undefined;
		}
		const [first, ...rest] = agentQueue;
		if (rest.length === 0) {
			this.state.delete(agentId);
		} else {
			this.state.set(agentId, rest);
		}
		this.notify();
		return first;
	};

	remove = (agentId: string | undefined, messageId: string) => {
		agentId ??= NEW_CHAT_ID;
		const agentQueue = this.state.get(agentId);
		if (!agentQueue || agentQueue.length === 0) {
			return;
		}
		const newQueue = agentQueue.filter((m) => m.id !== messageId);
		if (newQueue.length === 0) {
			this.state.delete(agentId);
		} else {
			this.state.set(agentId, newQueue);
		}
		this.notify();
	};

	clear = (agentId: string) => {
		if (this.state.delete(agentId)) {
			this.notify();
		}
	};

	promoteToFront = (agentId: string | undefined, messageId: string) => {
		agentId ??= NEW_CHAT_ID;
		const agentQueue = this.state.get(agentId);
		if (!agentQueue || agentQueue.length < 2) {
			return;
		}
		const idx = agentQueue.findIndex((m) => m.id === messageId);
		if (idx <= 0) {
			return;
		}
		const promoted = agentQueue[idx];
		const newQueue = [promoted, ...agentQueue.slice(0, idx), ...agentQueue.slice(idx + 1)];
		this.state.set(agentId, newQueue);
		this.notify();
	};

	reorder = (agentId: string | undefined, fromIndex: number, toIndex: number) => {
		agentId ??= NEW_CHAT_ID;
		const agentQueue = this.state.get(agentId);
		if (!agentQueue || agentQueue.length < 2 || fromIndex === toIndex) {
			return;
		}
		const newQueue = [...agentQueue];
		const [moved] = newQueue.splice(fromIndex, 1);
		newQueue.splice(toIndex, 0, moved);
		this.state.set(agentId, newQueue);
		this.notify();
	};

	moveQueue = (fromAgentId: string, toAgentId: string) => {
		const agentQueue = this.state.get(fromAgentId);
		if (!agentQueue) {
			return;
		}
		this.state.set(toAgentId, agentQueue);
		this.state.delete(fromAgentId);
		this.notify();
	};

	getSnapshot = (chatId: string | undefined) => this.state.get(chatId ?? NEW_CHAT_ID);
}

export const messageQueueStore = new MessageQueueStore();

/** Steers go before queued messages, so one the agent misses is still the next message sent. */
function insertInQueue(queue: QueuedMessage[], message: QueuedMessage): QueuedMessage[] {
	if (!message.steer) {
		return [...queue, message];
	}
	const firstQueuedIndex = queue.findIndex((m) => !m.steer);
	const insertIndex = firstQueuedIndex === -1 ? queue.length : firstQueuedIndex;
	return [...queue.slice(0, insertIndex), message, ...queue.slice(insertIndex)];
}
