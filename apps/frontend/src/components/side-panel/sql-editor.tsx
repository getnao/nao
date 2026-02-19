import { Editor } from '@monaco-editor/react';
import { ResizableSeparator, ResizablePanel, ResizablePanelGroup } from '../ui/resizable';
import type { executeSql } from '@nao/shared/tools';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const SidePanelContent = ({ input, output }: { input: executeSql.Input; output: executeSql.Output }) => {
	return (
		<ResizablePanelGroup orientation='vertical' defaultLayout={{ sql: 1 / 4, results: 1 }}>
			<ResizablePanel id='sql' minSize={100} className='relative w-full group'>
				<div className='w-full h-full overflow-auto [&_span]:font-mono pl-2'>
					<Editor
						value={input.sql_query}
						language='sql'
						theme='light'
						options={{
							minimap: {
								enabled: false,
							},
							folding: false,
							lineNumbers: 'off',
							scrollbar: {
								horizontal: 'hidden',
								vertical: 'hidden',
							},
							scrollBeyondLastLine: false,
							padding: {
								top: 16,
								bottom: 16,
							},
						}}
					/>
				</div>
			</ResizablePanel>

			{/* Keep for later use */}
			{/* <ResizablePanel id='sql' minSize={100} className='relative w-full group'>
				<Button
					onClick={() => copy(input.sql_query)}
					size='icon-xs'
					variant='ghost-muted'
					className='absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity bg-background'
				>
					{isCopied ? <Check /> : <Copy />}
				</Button>

				<div className='w-full h-full overflow-auto p-2 pr-10 [&_span]:font-mono'>
					<Prism
						language='sql'
						customStyle={{
							padding: 0,
							margin: 0,
							background: 'var(--background)',
							overflow: 'hidden',
							width: 'fit-content',
							fontSize: '0.875rem',
						}}
					>
						{input.sql_query}
					</Prism>
				</div>
			</ResizablePanel> */}

			<ResizableSeparator withHandle />

			<ResizablePanel id='results' minSize={100}>
				{output.row_count === 0 ? (
					<div className='p-4 text-center text-muted-foreground text-sm'>No rows returned</div>
				) : (
					<Table>
						<TableHeader className='sticky top-0 bg-background z-10'>
							<TableRow>
								{output.columns.map((column, i) => (
									<TableHead key={i}>{column}</TableHead>
								))}
							</TableRow>
						</TableHeader>

						<TableBody>
							{output.data?.map((row, rowIndex) => (
								<TableRow key={rowIndex}>
									{output.columns.map((column, cellIndex) => {
										const value = row[column];
										return (
											<TableCell key={cellIndex} className='font-mono text-xs'>
												{value == null ? (
													<span className='text-muted-foreground/50 italic'>NULL</span>
												) : (
													String(value)
												)}
											</TableCell>
										);
									})}
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</ResizablePanel>
		</ResizablePanelGroup>
	);
};
