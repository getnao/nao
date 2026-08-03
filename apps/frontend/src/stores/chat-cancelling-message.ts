import { SelectorStore } from './abstract-store';

class CancellingMessageIdStore extends SelectorStore<string | undefined> {
	protected state: string | undefined = undefined;

	isCancellingMessage = (messageId: string): boolean => this.state === messageId;

	setCancelling = (id: string | undefined) => {
		const prev = this.state;
		if (prev === id) {
			return;
		}
		this.state = id;
		if (prev) {
			this.notify(prev);
		}
		if (id) {
			this.notify(id);
		}
	};
}

export const cancellingMessageIdStore = new CancellingMessageIdStore();
