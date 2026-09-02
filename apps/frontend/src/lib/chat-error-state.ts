import { isDefinitiveChatError } from './trpc-error';

interface ChatErrorState {
	error: unknown;
	isError: boolean;
	isLoadingError: boolean;
}

export function shouldShowChatAccessError(state: ChatErrorState): boolean {
	return state.isLoadingError || (state.isError && isDefinitiveChatError(state.error));
}
