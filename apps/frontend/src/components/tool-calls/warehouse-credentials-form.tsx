import { useForm } from '@tanstack/react-form';
import { ShieldCheck } from 'lucide-react';

import {
	getClickHouseDefaultPort,
	getTrinoDefaultPort,
	getWarehouseCredentialsDefaults,
} from './warehouse-credentials';
import { providerHasField, SQL_PROVIDER_SETTINGS } from './warehouse-provider-config';
import type { WarehouseCredentialsFormValues } from './warehouse-credentials';
import type { SqlProvider, WarehouseCredentialField } from './warehouse-provider-config';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormError, PasswordField, TextareaField, TextField } from '@/components/ui/form-fields';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface WarehouseCredentialsFormProps {
	provider: SqlProvider;
	onSubmit: (values: WarehouseCredentialsFormValues) => Promise<void>;
	onCancel: () => void;
	isPending: boolean;
	error: { message: string } | null;
}

export function WarehouseCredentialsForm({
	provider,
	onSubmit,
	onCancel,
	isPending,
	error,
}: WarehouseCredentialsFormProps) {
	const settings = SQL_PROVIDER_SETTINGS[provider];
	const hasField = (field: WarehouseCredentialField) => providerHasField(provider, field);
	const form = useForm({
		defaultValues: getWarehouseCredentialsDefaults(provider),
		onSubmit: async ({ value }) => {
			await onSubmit(value);
		},
	});
	const replaceDefaultPort = (currentDefault: number, nextDefault: number) => {
		if (form.getFieldValue('port') === String(currentDefault)) {
			form.setFieldValue('port', String(nextDefault));
		}
	};

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				form.handleSubmit();
			}}
			className='flex flex-col gap-5'
		>
			<section className='space-y-3'>
				<div>
					<h3 className='text-sm font-medium text-foreground'>Connection profile</h3>
					<p className='text-xs text-muted-foreground'>Give this connection a recognizable name.</p>
				</div>
				<TextField
					form={form}
					name='name'
					label='Connection Name'
					placeholder={settings.defaultName}
					required={true}
				/>
			</section>
			<section className='space-y-3 rounded-xl border bg-muted/20 p-4'>
				<div>
					<h3 className='text-sm font-medium text-foreground'>Connection details</h3>
					<p className='text-xs text-muted-foreground'>Enter the details provided by {settings.label}.</p>
				</div>
				<div className='grid gap-4 sm:grid-cols-2 [&>*]:min-w-0'>
					{provider === 'bigquery' && (
						<>
							<TextField
								form={form}
								name='gcpProjectId'
								label='GCP Project ID'
								placeholder='Enter your GCP project ID'
								required={true}
							/>
							<TextField
								form={form}
								name='datasetId'
								label='Dataset ID'
								placeholder='Enter your dataset ID'
								required={false}
							/>
							<div className='sm:col-span-2'>
								<TextareaField
									form={form}
									name='serviceAccountJson'
									label='Service Account JSON'
									placeholder='Enter your service account JSON'
									required={true}
									rows={6}
								/>
							</div>
							<TextField
								form={form}
								name='location'
								label='Location'
								placeholder='Enter your location'
								required={false}
							/>
						</>
					)}
					{hasField('serverHostname') && (
						<TextField
							form={form}
							name='serverHostname'
							label='Server Hostname'
							placeholder='Enter your server hostname'
							required={true}
						/>
					)}
					{hasField('httpPath') && (
						<TextField
							form={form}
							name='httpPath'
							label='HTTP Path'
							placeholder='Enter your HTTP path'
							required={true}
						/>
					)}
					{hasField('accessToken') && (
						<PasswordField
							form={form}
							name='accessToken'
							label='Access Token'
							placeholder='Enter your access token'
							required={true}
						/>
					)}
					{hasField('catalog') && (
						<TextField
							form={form}
							name='catalog'
							label='Catalog'
							placeholder='Enter your catalog'
							required={provider === 'trino'}
						/>
					)}
					{hasField('host') && (
						<TextField form={form} name='host' label='Host' placeholder='localhost' required={true} />
					)}
					{hasField('port') && (
						<TextField
							form={form}
							name='port'
							label='Port'
							type='number'
							placeholder={String(settings.defaultPort)}
							required={true}
						/>
					)}
					{hasField('httpScheme') && (
						<form.Field name='httpScheme'>
							{(field) => (
								<div className='grid gap-2'>
									<label htmlFor='warehouse-http-scheme' className='text-sm font-medium'>
										HTTP Scheme
									</label>
									<Select
										value={field.state.value}
										onValueChange={(value) => {
											const nextScheme = value as 'http' | 'https';
											replaceDefaultPort(
												getTrinoDefaultPort(field.state.value),
												getTrinoDefaultPort(nextScheme),
											);
											field.handleChange(nextScheme);
										}}
									>
										<SelectTrigger id='warehouse-http-scheme'>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value='http'>HTTP</SelectItem>
											<SelectItem value='https'>HTTPS</SelectItem>
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>
					)}
					{hasField('database') && (
						<TextField
							form={form}
							name='database'
							label={provider === 'athena' ? 'Athena Database / Glue Schema' : 'Database Name'}
							placeholder='Enter your database name'
							required={provider !== 'athena' && provider !== 'motherduck' && provider !== 'starrocks'}
						/>
					)}
					{hasField('user') && (
						<TextField
							form={form}
							name='user'
							label='Username'
							placeholder='Enter your username'
							required={true}
						/>
					)}
					{hasField('password') && (
						<PasswordField
							form={form}
							name='password'
							label='Password'
							placeholder='Enter your password'
							required={provider !== 'clickhouse' && provider !== 'starrocks' && provider !== 'trino'}
						/>
					)}
					{hasField('schemaName') && (
						<TextField
							form={form}
							name='schemaName'
							label='Default Schema'
							hint={settings.schemaHint}
							placeholder='public'
						/>
					)}
					{provider === 'clickhouse' && (
						<>
							<form.Field name='protocol'>
								{(field) => (
									<div className='grid gap-2'>
										<label htmlFor='warehouse-protocol' className='text-sm font-medium'>
											Protocol
										</label>
										<Select
											value={field.state.value}
											onValueChange={(value) => {
												const nextProtocol = value as 'http' | 'native';
												const secure = form.getFieldValue('secure');
												replaceDefaultPort(
													getClickHouseDefaultPort(field.state.value, secure),
													getClickHouseDefaultPort(nextProtocol, secure),
												);
												field.handleChange(nextProtocol);
											}}
										>
											<SelectTrigger id='warehouse-protocol'>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value='http'>HTTP</SelectItem>
												<SelectItem value='native'>Native TCP</SelectItem>
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>
							<form.Field name='secure'>
								{(field) => (
									<label className='flex items-center gap-2 text-sm font-medium'>
										<Checkbox
											checked={field.state.value}
											onCheckedChange={(checked) => {
												const nextSecure = checked === true;
												const protocol = form.getFieldValue('protocol');
												replaceDefaultPort(
													getClickHouseDefaultPort(protocol, field.state.value),
													getClickHouseDefaultPort(protocol, nextSecure),
												);
												field.handleChange(nextSecure);
											}}
										/>
										Use secure connection
									</label>
								)}
							</form.Field>
						</>
					)}
					{provider === 'snowflake' && (
						<>
							<TextField
								form={form}
								name='warehouse'
								label='Warehouse'
								placeholder='Enter your warehouse name'
								required={false}
							/>
							<TextField
								form={form}
								name='accountId'
								label='Account Identifier'
								placeholder='Enter your account ID'
								required={true}
							/>
						</>
					)}
					{provider === 'fabric' && (
						<>
							<TextField
								form={form}
								name='clientId'
								label='Client ID'
								placeholder='Enter your client ID'
								required={true}
							/>
							<PasswordField
								form={form}
								name='clientSecret'
								label='Client Secret'
								placeholder='Enter your client secret'
								required={true}
							/>
							<TextField
								form={form}
								name='tenantId'
								label='Tenant ID'
								placeholder='Enter your tenant ID'
								required={false}
							/>
						</>
					)}
					{hasField('driver') && (
						<TextField
							form={form}
							name='driver'
							label='Driver'
							placeholder='Enter your driver'
							required={false}
						/>
					)}
					{provider === 'athena' && (
						<>
							<TextField
								form={form}
								name='awsRegion'
								label='AWS Region'
								placeholder='Enter your AWS region'
								required={true}
							/>
							<TextField
								form={form}
								name='s3StagingDirectory'
								label='S3 Staging Directory'
								placeholder='Enter your S3 staging directory'
								required={true}
							/>
							<TextField
								form={form}
								name='workgroupName'
								label='Workgroup Name'
								placeholder='Enter your workgroup name'
								required={false}
							/>
							<TextField
								form={form}
								name='awsAccessKeyId'
								label='AWS Access Key ID'
								placeholder='Enter your AWS access key ID'
								required={true}
							/>
							<PasswordField
								form={form}
								name='awsSecretAccessKey'
								label='AWS Secret Access Key'
								placeholder='Enter your AWS secret access key'
								required={true}
							/>
							<PasswordField
								form={form}
								name='awsSessionToken'
								label='AWS Session Token'
								placeholder='Enter your AWS session token'
								required={false}
							/>
						</>
					)}
				</div>
			</section>
			<div className='flex items-start gap-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5'>
				<ShieldCheck className='mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400' />
				<p className='text-xs leading-relaxed text-muted-foreground'>
					Your credentials are encrypted and submitted directly. They are never included in the chat.
				</p>
			</div>
			{error && <FormError error={error.message} />}
			<div className='flex justify-end gap-2 border-t pt-4'>
				<Button variant='ghost' size='sm' type='button' onClick={onCancel}>
					Cancel
				</Button>
				<form.Subscribe selector={(state: { canSubmit: boolean }) => state.canSubmit}>
					{(canSubmit: boolean) => (
						<Button size='sm' type='submit' disabled={!canSubmit || isPending}>
							{isPending ? 'Connecting…' : 'Connect'}
						</Button>
					)}
				</form.Subscribe>
			</div>
		</form>
	);
}
