import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { Pool, type PoolConfig } from 'pg';

import * as deleteTable from './operations/deleteTable';
import * as executeQuery from './operations/executeQuery';
import * as insert from './operations/insert';
import * as select from './operations/select';
import * as update from './operations/update';
import * as upsert from './operations/upsert';

import type { OpenGaussCredentials } from '../helpers/types';

type OperationName = 'executeQuery' | 'insert' | 'select' | 'update' | 'upsert' | 'deleteTable';

const operations: Record<
	OperationName,
	{
		execute: (
			this: IExecuteFunctions,
			client: import('pg').PoolClient,
			items: INodeExecutionData[],
		) => Promise<INodeExecutionData[]>;
	}
> = {
	executeQuery,
	insert,
	select,
	update,
	upsert,
	deleteTable,
};

function buildPoolConfig(creds: OpenGaussCredentials): PoolConfig {
	const ssl =
		creds.ssl === 'require'
			? { rejectUnauthorized: false }
			: false;

	return {
		host: creds.host,
		port: Number(creds.port),
		database: creds.database,
		user: creds.user,
		password: creds.password,
		ssl,
		max: creds.maxConnections ?? 10,
	};
}

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const operation = this.getNodeParameter('operation', 0) as OperationName;

	if (!operations[operation]) {
		throw new NodeOperationError(
			this.getNode(),
			`The operation "${operation}" is not supported!`,
		);
	}

	const credentials = (await this.getCredentials('openGaussDataVecApi')) as unknown as
		OpenGaussCredentials;

	const pool = new Pool(buildPoolConfig(credentials));
	let returnData: INodeExecutionData[] = [];

	try {
		const client = await pool.connect();
		try {
			returnData = await operations[operation].execute.call(this, client, items);
		} finally {
			client.release();
		}
	} finally {
		await pool.end().catch(() => undefined);
	}

	return [returnData];
}
