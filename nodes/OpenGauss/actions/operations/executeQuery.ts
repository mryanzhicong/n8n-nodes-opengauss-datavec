import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { PoolClient } from 'pg';

export const description: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		default: '',
		placeholder: 'e.g. SELECT id, name FROM product WHERE quantity > $1 AND price <= $2',
		noDataExpression: true,
		required: true,
		description:
			"The SQL query to execute. Use $1, $2, $3, etc to refer to the 'Query Parameters' set in options below.",
		typeOptions: {
			editor: 'sqlEditor',
			sqlDialect: 'PostgreSQL',
		},
		hint: 'Use parameterized queries ($1, $2, ...) to prevent SQL injection',
		displayOptions: {
			show: { resource: ['database'], operation: ['executeQuery'] },
		},
	},
];

function parseReplacementValues(raw: unknown): unknown[] {
	if (raw === undefined || raw === null || raw === '') return [];
	if (Array.isArray(raw)) return raw;
	if (typeof raw === 'number' || typeof raw === 'boolean') return [raw];
	if (typeof raw === 'string') {
		const trimmed = raw.trim();
		if (trimmed === '') return [];
		// try JSON array first
		if (trimmed.startsWith('[')) {
			try {
				const parsed = JSON.parse(trimmed);
				if (Array.isArray(parsed)) return parsed;
			} catch {}
		}
		return trimmed
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}
	return [raw];
}

export async function execute(
	this: IExecuteFunctions,
	client: PoolClient,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const returnData: INodeExecutionData[] = [];
	const continueOnFail = this.continueOnFail();

	for (let i = 0; i < items.length; i++) {
		try {
			const query = this.getNodeParameter('query', i) as string;
			const replacementRaw = this.getNodeParameter(
				'options.queryReplacement',
				i,
				'',
			) as unknown;
			const values = parseReplacementValues(replacementRaw);

			const result = await client.query(query, values);
			const rows = (result.rows ?? []) as IDataObject[];

			if (rows.length === 0) {
				returnData.push({ json: { success: true }, pairedItem: { item: i } });
			} else {
				for (const row of rows) {
					returnData.push({ json: row, pairedItem: { item: i } });
				}
			}
		} catch (error) {
			if (continueOnFail) {
				const message = error instanceof Error ? error.message : String(error);
				returnData.push({
					json: { error: message },
					pairedItem: { item: i },
				});
				continue;
			}
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
		}
	}

	return returnData;
}
