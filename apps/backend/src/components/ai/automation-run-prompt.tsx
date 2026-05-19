import { Fragment } from 'react';

import { Block, Code, List, ListItem, renderToMarkdown, Span, Title } from '../../lib/markdown';
import {
	type AutomationIntegrationToolName,
	getAutomationIntegrationToolDescriptions,
	getAutomationIntegrationToolNames,
} from '../../services/automation-tools';
import type { AutomationIntegrationConfig } from '../../types/automation';

type AutomationRunPromptProps = {
	prompt: string;
	integrations: AutomationIntegrationConfig;
	userEmail: string;
};

export function renderAutomationRunPrompt(props: AutomationRunPromptProps): string {
	return renderToMarkdown(<AutomationRunPrompt {...props} />);
}

function AutomationRunPrompt({ prompt, integrations, userEmail }: AutomationRunPromptProps) {
	const requiredTools = getAutomationIntegrationToolNames(integrations);

	return (
		<Block>
			<Span>[Automation run]</Span>
			<Span>
				This is an automation run, not an interactive chat. There is NO human reading the chat output. The only
				way for your work to reach a human is by calling one of the outbound tools listed below.
			</Span>

			<Title>Requesting user</Title>
			<Span>
				This automation is running on behalf of {userEmail}. If the prompt refers to &quot;me&quot;, &quot;my
				email&quot;, &quot;the user&quot;, or the requester as an email recipient, use this email address.
			</Span>

			<Title>Outbound tools available for this run</Title>
			<AutomationIntegrationsList integrations={integrations} />

			<Title>Required behaviour</Title>
			<List ordered>
				<ListItem>
					Investigate the request below using the data tools (execute_sql, list, read, search, MCP tools,
					etc.).
				</ListItem>
				<ListItem>Compose the report or content that should be delivered.</ListItem>
				{requiredTools.length > 0 ? (
					<ListItem>
						You MUST call <FormattedToolList tools={requiredTools} /> to actually deliver the result. Do NOT
						just describe what you would send - call the tool with the real payload. Calling these tools is
						the success criterion of the run.
					</ListItem>
				) : (
					<ListItem>Return the result as your final assistant text response.</ListItem>
				)}
				<ListItem>Do NOT call suggest_follow_ups; this run has no human follow-up.</ListItem>
			</List>

			<Title>Automation prompt</Title>
			<Span>{prompt}</Span>
		</Block>
	);
}

function AutomationIntegrationsList({ integrations }: { integrations: AutomationIntegrationConfig }) {
	const toolDescriptions = getAutomationIntegrationToolDescriptions(integrations);

	if (toolDescriptions.length === 0) {
		return (
			<Span>
				No outbound integrations are configured. In this case, just produce the requested analysis as your final
				text.
			</Span>
		);
	}

	return (
		<List>
			{toolDescriptions.map((tool) => (
				<ListItem key={tool.name}>
					<Code>{tool.name}</Code> - {tool.description}
				</ListItem>
			))}
		</List>
	);
}

function FormattedToolList({ tools }: { tools: AutomationIntegrationToolName[] }) {
	if (tools.length === 1) {
		return <Code>{tools[0]}</Code>;
	}

	const lastTool = tools[tools.length - 1];
	const leadingTools = tools.slice(0, -1);

	return (
		<Span>
			{leadingTools.map((tool, index) => (
				<Fragment key={tool}>
					{index > 0 ? ', ' : ''}
					<Code>{tool}</Code>
				</Fragment>
			))}{' '}
			and <Code>{lastTool}</Code>
		</Span>
	);
}
