import { AgentSettings } from './agent-settings';

export interface ToolContext {
	projectFolder: string;
	chatId: string;
	agentSettings: AgentSettings | null;
}
