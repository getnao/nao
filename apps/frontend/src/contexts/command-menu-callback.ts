import { createCallbackContext } from '@/contexts/create-callback-context';

const commandMenuCallbackContext = createCallbackContext<() => void>();

export const CommandMenuCallbackProvider = commandMenuCallbackContext.Provider;
export const useCommandMenuCallback = commandMenuCallbackContext.useContext;
export const useRegisterCommandMenuCallback = commandMenuCallbackContext.useRegister;
