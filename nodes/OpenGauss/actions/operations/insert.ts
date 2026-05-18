import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { PoolClient } from 'pg';

import {
	addReturning,
	buildInsertColumns,
	parseOutputColumns,
	quoteTable,
} from '../../helpers/queryBuilder';

const showOnInsert = { resource: ['database'], operation: ['insert'] };

export const description: INodeProperties[] = [
	{
		displayName: 'Schema',
		name: 'schema',
		type: 'string',
		default: 'public',
		required: true,
		placeholder: 'e.g. public',
		description: 'The schema that contains the table you want to write to',
		displayOptions: { show: showOnInsert },
	},
	{
		displayName: 'Table',
		name: 'table',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. my_table',
		description: 'The name of the table you want to insert data into',
		displayOptions: { show: showOnInsert },
	},
	{
		displayName: 'Data Mode',
		name: 'dataMode',
		type: 'options',
		options: [
			{
				name: 'Auto-Map Input Data to Columns',
				value: 'autoMapInputData',
				description: 'Use when node input properties names exactly match the table column names',
			},
			{
				name: 'Map Each Column Manually',
				value: 'defineBelow',
				description: 'Set the value for each destination column manually',
			},
		],
		default: 'autoMapInputData',
		description:
			'Whether to map node input properties and the table data automatically or manually',
		displayOptions: { show: showOnInsert },
	},
	{
		displayName: `In this mode, make sure incoming data fields are named the same as the columns in your table.`,
		name: 'notice',
		type: 'notice',
		default: '',
		displayOptions: {
			show: { ...showOnInsert, dataMode: ['autoMapInputData'] },
		},
	},
	{
		displayName: 'Values to Send',
		name: 'valuesToSend',
		placeholder: 'Add Value',
		type: 'fixedCollection',
		typeOptions: {
			multipleValueButtonText: 'Add Value',
			multipleValues: true,
		},
		displayOptions: {
			show: { ...showOnInsert, dataMode: ['defineBelow'] },
		},
		default: {},
		options: [
			{
				displayName: 'Values',
				name: 'values',
				values: [
					{
						displayName: 'Column',
						name: 'column',
						type: 'string',
						default: '',
						placeholder: 'e.g. name',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
];

function buildItem(this: IExecuteFunctions, i: number, items: INodeExecutionData[]): IDataObject {
	const dataMode = this.getNodeParameter('dataMode', i) as string;
	if (dataMode === 'autoMapInputData') {
		return { ...(items[i].json as IDataObject) };
	}
	const values = (this.getNodeParameter('valuesToSend', i, {}) as IDataObject).values as
		| IDataObject[]
		| undefined;
	const item: IDataObject = {};
	if (Array.isArray(values)) {
		for (const entry of values) {
			const col = String(entry.column ?? '').trim();
			if (col) item[col] = entry.value;
		}
	}
	return item;
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
			const schema = (this.getNodeParameter('schema', i, 'public') as string) || 'public';
			const table = this.getNodeParameter('table', i) as string;
			const options = this.getNodeParameter('options', i, {}) as IDataObject;
			const outputColumns = parseOutputColumns(options.outputColumns);
			const skipOnConflict = Boolean(options.skipOnConflict);

			const item = buildItem.call(this, i, items);
			const tableSql = quoteTable(schema, table);

			let query: string;
			let values: unknown[] = [];

			if (Object.keys(item).length === 0) {
				query = `INSERT INTO ${tableSql} DEFAULT VALUES`;
			} else {
				const built = buildInsertColumns(item, 1);
				query = `INSERT INTO ${tableSql} (${built.columnsSql}) VALUES (${built.valuesSql})`;
				values = built.values;
			}

			if (skipOnConflict) {
				query += ' ON CONFLICT DO NOTHING';
			}

			query = addReturning(query, outputColumns);

			const result = await client.query(query, values);
			const rows = (result.rows ?? []) as IDataObject[];

			if (rows.length === 0) {
				returnData.push({
					json: { success: true, affectedRows: result.rowCount ?? 0 },
					pairedItem: { item: i },
				});
			} else {
				for (const row of rows) {
					returnData.push({ json: row, pairedItem: { item: i } });
				}
			}
		} catch (error) {
			if (continueOnFail) {
				const message = error instanceof Error ? error.message : String(error);
				returnData.push({ json: { error: message }, pairedItem: { item: i } });
				continue;
			}
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
		}
	}

	return returnData;
}
