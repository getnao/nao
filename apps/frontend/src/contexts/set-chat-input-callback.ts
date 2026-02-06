import { createCallbackContext } from '@/contexts/create-callback-context';

const setChatInputCallbackContext = createCallbackContext<(text: string) => void>();

export const SetChatInputCallbackProvider = setChatInputCallbackContext.Provider;
export const useSetChatInputCallback = setChatInputCallbackContext.useContext;
export const useRegisterSetChatInputCallback = setChatInputCallbackContext.useRegister;
