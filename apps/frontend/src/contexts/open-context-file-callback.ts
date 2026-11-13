import { createCallbackContext } from '@/contexts/create-callback-context';

const openContextFileCallbackContext = createCallbackContext<(path: string) => void>();

export const OpenContextFileCallbackProvider = openContextFileCallbackContext.Provider;
export const useOpenContextFileCallback = openContextFileCallbackContext.useContext;
export const useRegisterOpenContextFileCallback = openContextFileCallbackContext.useRegister;
