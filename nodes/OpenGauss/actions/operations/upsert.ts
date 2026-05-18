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
	quoteIdent,
	quoteTable,
} from '../../helpers/queryBuilder';

const showOnUpsert = { resource: ['database'], operation: ['upsert'] };

export const description: INodeProperties[] = [
	{
		displayName: 'Schema',
		name: 'schema',
		type: 'string',
		default: 'public',
		required: true,
		displayOptions: { show: showOnUpsert },
	},
	{
		displayName: 'Table',
		name: 'table',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showOnUpsert },
	},
	{
		displayName: 'Unique Column',
		name: 'columnToMatchOn',
		type: 'string',
		default: '',
		required: true,
		hint: "Used to find rows to update. Doesn't get changed. Has to be unique.",
		displayOptions: { show: showOnUpsert },
	},
	{
		displayName: 'Data Mode',
		name: 'dataMode',
		type: 'options',
		options: [
			{ name: 'Auto-Map Input Data to Columns', value: 'autoMapInputData' },
			{ name: 'Map Each Column Manually', value: 'defineBelow' },
		],
		default: 'autoMapInputData',
		displayOptions: { show: showOnUpsert },
	},
	{
		displayName: 'Value of Unique Column',
		name: 'valueToMatchOn',
		type: 'string',
		default: '',
		displayOptions: {
			show: { ...showOnUpsert, dataMode: ['defineBelow'] },
		},
	},
	{
		displayName: 'Values to Send',
		name: 'valuesToSend',
		placeholder: 'Add Value',
		type: 'fixedCollection',
		typeOptions: { multipleValueButtonText: 'Add Value', multipleValues: true },
		default: {},
		displayOptions: {
			show: { ...showOnUpsert, dataMode: ['defineBelow'] },
		},
		options: [
			{
				displayName: 'Values',
				name: 'values',
				values: [
					{ displayName: 'Column', name: 'column', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
];

function collectItem(
	this: IExecuteFunctions,
	i: number,
	items: INodeExecutionData[],
): IDataObject {
	const dataMode = this.getNodeParameter('dataMode', i) as string;
	if (dataMode === 'autoMapInputData') {
		return { ...(items[i].json as IDataObject) };
	}
	const valuesToSend = (this.getNodeParameter('valuesToSend', i, {}) as IDataObject).values as
		| IDataObject[]
		| undefined;
	const item: IDataObject = {};
	if (Array.isArray(valuesToSend)) {
		for (const entry of valuesToSend) {
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
			const columnToMatchOn = this.getNodeParameter('columnToMatchOn', i) as string;
			const dataMode = this.getNodeParameter('dataMode', i) as string;
			const options = this.getNodeParameter('options', i, {}) as IDataObject;
			const outputColumns = parseOutputColumns(options.outputColumns);

			const item = collectItem.call(this, i, items);
			if (dataMode === 'defineBelow') {
				item[columnToMatchOn] = this.getNodeParameter('valueToMatchOn', i) as string;
			}

			if (item[columnToMatchOn] === undefined || item[columnToMatchOn] === null) {
				throw new NodeOperationError(
					this.getNode(),
					`Unique column '${columnToMatchOn}' must have a value`,
					{ itemIndex: i },
				);
			}
			if (Object.keys(item).length === 1) {
				throw new NodeOperationError(
					this.getNode(),
					'Add at least one value besides the unique column',
					{ itemIndex: i },
				);
			}

			const built = buildInsertColumns(item, 1);
			const tableSql = quoteTable(schema, table);

			let query =
				`INSERT INTO ${tableSql} (${built.columnsSql}) VALUES (${built.valuesSql}) ` +
				`ON CONFLICT (${quoteIdent(columnToMatchOn)})`;

			const updateColumns = built.columns.filter((c) => c !== columnToMatchOn);
			if (updateColumns.length === 0) {
				query += ' DO NOTHING';
			} else {
				const setParts = updateColumns.map(
					(c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`,
				);
				query += ` DO UPDATE SET ${setParts.join(', ')}`;
			}

			query = addReturning(query, outputColumns);

			const result = await client.query(query, built.values);
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
			if (error instanceof NodeOperationError) throw error;
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
		}
	}

	return returnData;
}
