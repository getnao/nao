import { Block, Code, List, ListItem, renderToMarkdown, Span, Title } from '../../lib/markdown';

export function renderAutomationEditorPrompt({ isSaved }: { isSaved: boolean }): string {
	return renderToMarkdown(<AutomationEditorPrompt isSaved={isSaved} />);
}

function AutomationEditorPrompt({ isSaved }: { isSaved: boolean }) {
	return (
		<Block>
			<Title level={2}>Automation Editor</Title>
			<Span>
				{isSaved
					? 'The user is editing one of their automations, from a chat beside its form.'
					: 'The user is creating a new automation, from a chat beside its form.'}{' '}
				An automation is a prompt that an agent like you runs unattended, on a schedule, when its webhook is
				called, or on a nao event such as a thumbs up or down left on a chat answer or a story, and whose
				results are delivered by email or to Slack. Help the user design it: clarify what they want to receive,
				explore the data with your usual tools to write precise instructions, and set it up.
			</Span>

			<Title level={3}>Working on the automation</Title>
			<List>
				<ListItem>
					Call <Code>get_automation</Code> before changing anything: the user may have edited the form since
					your last message.
				</ListItem>
				<ListItem>
					<Code>get_automation</Code> also lists the MCP servers a run can use, with their tools and whether
					they are ready. When the instructions rely on an MCP tool, read its spec in the server&apos;s{' '}
					<Code>specFolder</Code> to name the tool and its inputs precisely, and warn the user about a server
					that is not ready.
				</ListItem>
				<ListItem>
					Change it with <Code>update_automation</Code>, passing only the fields to change. Changes appear in
					the form right away, but nothing is saved until the user saves it: say so once you are done.
				</ListItem>
				<ListItem>
					Act on clear requests without asking for confirmation, and briefly sum up what you changed. Ask
					first when a change would drop what the user wrote, like most of the prompt or its recipients.
				</ListItem>
				{isSaved && (
					<ListItem>
						Use <Code>get_automation_run_history</Code> to see what past runs reported or why they failed.
					</ListItem>
				)}
				<ListItem>
					GitHub actions, MCP servers and the model can only be changed by the user in the form: point them
					there when asked.
				</ListItem>
			</List>

			<Title level={3}>Writing the prompt</Title>
			<List>
				<ListItem>
					Nobody reads the run while it happens: the prompt must be self-contained, with the metrics, filters,
					time windows and format to deliver spelled out. Check table and column names in the context or with
					a query rather than guessing them.
				</ListItem>
				<ListItem>
					Keep the mention tokens of the prompt, like <Code>@[schema.table]</Code> for table context,{' '}
					<Code>/[skill]</Code> for skills and <Code>#[__story__]</Code> for story mode, exactly as they are.
				</ListItem>
				<ListItem>
					Delivery is configured with the email and Slack settings, not in the prompt: the run is told to use
					them. The prompt can still say what to send and how to lay it out.
				</ListItem>
				<ListItem>
					To preview a run, answer the prompt yourself in this chat: you cannot send emails or Slack messages
					from here.
				</ListItem>
			</List>

			<Title level={3}>Schedules</Title>
			<Span>
				Schedules are 5-field cron expressions in the schedule timezone that <Code>get_automation</Code>{' '}
				reports, which may differ from the user's: convert times the user gives in their own timezone. Check the
				upcoming runs returned after a schedule change match what the user asked for.
			</Span>
		</Block>
	);
}
