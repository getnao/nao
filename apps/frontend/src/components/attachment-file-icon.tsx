import { fileExtension } from '@nao/shared/attachments';
import { FileCode, FileJson, FileSpreadsheet, FileText, FileType } from 'lucide-react';

import { cn } from '@/lib/utils';

const ICONS = {
	csv: FileSpreadsheet,
	tsv: FileSpreadsheet,
	xls: FileSpreadsheet,
	xlsx: FileSpreadsheet,
	parquet: FileSpreadsheet,
	json: FileJson,
	jsonl: FileJson,
	yaml: FileCode,
	yml: FileCode,
	xml: FileCode,
	html: FileCode,
	sql: FileCode,
	pdf: FileType,
	docx: FileType,
} as const;

const COLORS = {
	csv: 'text-emerald-500',
	tsv: 'text-emerald-500',
	xls: 'text-emerald-500',
	xlsx: 'text-emerald-500',
	parquet: 'text-emerald-500',
	json: 'text-amber-500',
	jsonl: 'text-amber-500',
	pdf: 'text-red-500',
	docx: 'text-blue-500',
} as const;

export function AttachmentFileIcon({ fileName, className }: { fileName: string; className?: string }) {
	const extension = fileExtension(fileName) as keyof typeof ICONS;
	const Icon = ICONS[extension] ?? FileText;
	const color = COLORS[extension as keyof typeof COLORS] ?? 'text-muted-foreground';

	return <Icon className={cn(color, className)} />;
}
