import { AgentSettings } from './agent-settings';

export interface ToolContext {
	projectFolder: string;
	agentSettings: AgentSettings | null;
}
