import { SelectorStore } from './abstract-store';

class EditedMessageIdStore extends SelectorStore<string | undefined> {
	protected state: string | undefined = undefined;

	isEditingMessage = (messageId: string): boolean => this.state === messageId;

	setEditingId = (id: string | undefined) => {
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

export const editedMessageIdStore = new EditedMessageIdStore();
