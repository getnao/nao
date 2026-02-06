import { DBProjectSavedPrompt } from '../db/abstractSchema';

export type SavedPrompt = Omit<DBProjectSavedPrompt, 'projectId'>;
