import { createCallbackContext } from '@/contexts/create-callback-context';

const setChatInputCallbackContext = createCallbackContext<(text: string) => void>();

export const SetChatInputCallbackProvider = setChatInputCallbackContext.Provider;
export const useSetChatInputCallback = setChatInputCallbackContext.useContext;
export const useRegisterSetChatInputCallback = setChatInputCallbackContext.useRegister;

/** Lets an input be filled by follow-up suggestions, its latest `onFill` registered so it never fills a stale prompt. */
export function FollowUpFiller({ onFill }: { onFill: (text: string) => void }) {
	useRegisterSetChatInputCallback(onFill, [onFill]);
	return null;
}
