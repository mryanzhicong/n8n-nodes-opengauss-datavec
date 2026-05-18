import {
	NodeConnectionTypes,
	type ICredentialTestFunctions,
	type ICredentialsDecrypted,
	type IExecuteFunctions,
	type INodeCredentialTestResult,
	type INodeExecutionData,
	type INodeProperties,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';
import { Pool, type PoolConfig } from 'pg';

import { router } from './actions/router';
import { description as executeQueryProps } from './actions/operations/executeQuery';
import { description as insertProps } from './actions/operations/insert';
import { description as selectProps } from './actions/operations/select';
import { description as updateProps } from './actions/operations/update';
import { description as upsertProps } from './actions/operations/upsert';
import { description as deleteTableProps } from './actions/operations/deleteTable';

const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'hidden',
	noDataExpression: true,
	default: 'database',
	options: [{ name: 'Database', value: 'database' }],
};

const operationProperty: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['database'] } },
	options: [
		{
			name: 'Delete',
			value: 'deleteTable',
			description: 'Delete an entire table or rows in a table',
			action: 'Delete a table or rows in openGauss',
		},
		{
			name: 'Execute Query',
			value: 'executeQuery',
			description: 'Execute an SQL query',
			action: 'Execute a SQL query in openGauss',
		},
		{
			name: 'Insert',
			value: 'insert',
			description: 'Insert rows in a table',
			action: 'Insert rows in openGauss',
		},
		{
			name: 'Select',
			value: 'select',
			description: 'Select rows from a table',
			action: 'Select rows from openGauss',
		},
		{
			name: 'Update',
			value: 'update',
			description: 'Update rows in a table',
			action: 'Update rows in openGauss',
		},
		{
			name: 'Upsert',
			value: 'upsert',
			description: 'Insert or update rows in a table',
			action: 'Insert or update rows in openGauss',
		},
	],
	default: 'insert',
};

const optionsCollection: INodeProperties = {
	displayName: 'Options',
	name: 'options',
	type: 'collection',
	placeholder: 'Add option',
	default: {},
	displayOptions: { show: { resource: ['database'] } },
	options: [
		{
			displayName: 'Cascade',
			name: 'cascade',
			type: 'boolean',
			default: false,
			description:
				'Whether to drop all objects that depend on the table, such as views and sequences',
			displayOptions: {
				show: { '/operation': ['deleteTable'] },
				hide: { '/deleteCommand': ['delete'] },
			},
		},
		{
			displayName: 'Query Parameters',
			name: 'queryReplacement',
			type: 'string',
			default: '',
			description: 'Comma-separated list of values to use as query parameters ($1, $2, ...)',
			hint: 'Reference them in your query as $1, $2, $3…',
			placeholder: 'e.g. value1,value2,value3',
			displayOptions: { show: { '/operation': ['executeQuery'] } },
		},
		{
			displayName: 'Output Columns',
			name: 'outputColumns',
			type: 'string',
			default: '',
			description:
				'Comma-separated list of columns to return. Use * to return all columns. Leave empty to skip RETURNING.',
			placeholder: 'e.g. id,name,*',
			displayOptions: {
				show: { '/operation': ['select', 'insert', 'update', 'upsert'] },
			},
		},
		{
			displayName: 'Skip on Conflict',
			name: 'skipOnConflict',
			type: 'boolean',
			default: false,
			description:
				'Whether to skip the row instead of throwing an error if a unique constraint is violated',
			displayOptions: { show: { '/operation': ['insert'] } },
		},
	],
};

const description: INodeTypeDescription = {
	displayName: 'openGauss',
	name: 'openGauss',
	icon: 'file:opengauss.svg',
	group: ['input'],
	version: 1,
	subtitle: '={{$parameter["operation"]}}',
	description: 'Get, add and update data in openGauss',
	defaults: { name: 'openGauss' },
	usableAsTool: true,
	inputs: [NodeConnectionTypes.Main],
	outputs: [NodeConnectionTypes.Main],
	credentials: [
		{
			name: 'openGaussDataVecApi',
			required: true,
			testedBy: 'openGaussConnectionTest',
		},
	],
	properties: [
		resourceProperty,
		operationProperty,
		...executeQueryProps,
		...insertProps,
		...selectProps,
		...updateProps,
		...upsertProps,
		...deleteTableProps,
		optionsCollection,
	],
};

export class OpenGauss implements INodeType {
	description: INodeTypeDescription = description;

	methods = {
		credentialTest: {
			async openGaussConnectionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const creds = credential.data as unknown as {
					host: string;
					port: number;
					database: string;
					user: string;
					password: string;
					ssl?: 'disable' | 'allow' | 'require';
					maxConnections?: number;
				};

				const ssl =
					creds.ssl === 'require'
						? { rejectUnauthorized: false }
						: false;

				const config: PoolConfig = {
					host: creds.host,
					port: Number(creds.port),
					database: creds.database,
					user: creds.user,
					password: creds.password,
					ssl,
					max: creds.maxConnections ?? 1,
				};

				const pool = new Pool(config);
				try {
					const client = await pool.connect();
					try {
						await client.query('SELECT 1');
					} finally {
						client.release();
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					await pool.end().catch(() => undefined);
					return { status: 'Error', message };
				}

				await pool.end().catch(() => undefined);
				return { status: 'OK', message: 'Connection successful!' };
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		return await router.call(this);
	}
}
