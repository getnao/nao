import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { LOCAL_AGENT_TOOL_PREFIX } from '@nao/shared/local-agent';

const FOLLOW_UPS_TOOL = 'suggest_follow_ups';
const TURN_ENDING_TOOLS = new Set([
	'clarification',
	'request_warehouse_selection',
	'request_warehouse_credentials',
	'restart_onboarding',
]);

/**
 * Mirrors the server agent's stop conditions: the turn ends after a tool that hands back to the
 * user, and after `suggest_follow_ups` once the answer is written. Without it Claude reads the
 * follow-ups result and writes its answer a second time.
 */
export class TurnStopPolicy {
	private readonly _messagesWithText = new Set<string>();
	private readonly _messageByToolUse = new Map<string, string>();
	private readonly _followUpsMessages = new Set<string>();

	observe(message: SDKMessage): void {
		if (message.type !== 'assistant' || message.parent_tool_use_id) {
			return;
		}
		const { id, content } = message.message;
		for (const block of content) {
			if (block.type === 'text' && block.text.trim()) {
				this._messagesWithText.add(id);
			} else if (block.type === 'tool_use') {
				this._messageByToolUse.set(block.id, id);
			}
		}
	}

	/** Textless `suggest_follow_ups` in a later step ends the turn anyway, so the loop cannot spin. */
	endsTurn(claudeToolName: string, toolUseId: string): boolean {
		if (!claudeToolName.startsWith(LOCAL_AGENT_TOOL_PREFIX)) {
			return false;
		}
		const toolName = claudeToolName.slice(LOCAL_AGENT_TOOL_PREFIX.length);
		if (TURN_ENDING_TOOLS.has(toolName)) {
			return true;
		}
		if (toolName !== FOLLOW_UPS_TOOL) {
			return false;
		}
		const messageId = this._messageByToolUse.get(toolUseId) ?? toolUseId;
		const retried = [...this._followUpsMessages].some((earlier) => earlier !== messageId);
		this._followUpsMessages.add(messageId);
		return this._messagesWithText.has(messageId) || retried;
	}
}
