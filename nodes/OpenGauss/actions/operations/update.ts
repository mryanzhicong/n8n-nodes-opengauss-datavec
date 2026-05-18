import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { PoolClient } from 'pg';

import { addReturning, parseOutputColumns, quoteIdent, quoteTable } from '../../helpers/queryBuilder';

const showOnUpdate = { resource: ['database'], operation: ['update'] };

export const description: INodeProperties[] = [
	{
		displayName: 'Schema',
		name: 'schema',
		type: 'string',
		default: 'public',
		required: true,
		displayOptions: { show: showOnUpdate },
	},
	{
		displayName: 'Table',
		name: 'table',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showOnUpdate },
	},
	{
		displayName: 'Column to Match On',
		name: 'columnToMatchOn',
		type: 'string',
		default: '',
		required: true,
		hint: 'The column to match input items to existing rows. Usually an ID.',
		displayOptions: { show: showOnUpdate },
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
		displayOptions: { show: showOnUpdate },
	},
	{
		displayName: 'Value of Column to Match On',
		name: 'valueToMatchOn',
		type: 'string',
		default: '',
		description: 'Rows whose match column equals this value will be updated',
		displayOptions: {
			show: { ...showOnUpdate, dataMode: ['defineBelow'] },
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
			show: { ...showOnUpdate, dataMode: ['defineBelow'] },
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

			let matchValue: unknown;
			if (dataMode === 'defineBelow') {
				matchValue = this.getNodeParameter('valueToMatchOn', i) as string;
				item[columnToMatchOn] = matchValue as IDataObject[string];
			} else {
				matchValue = item[columnToMatchOn];
				if (matchValue === undefined) {
					throw new NodeOperationError(
						this.getNode(),
						`Column to match on '${columnToMatchOn}' not found in input item`,
						{ itemIndex: i },
					);
				}
			}

			const updateColumns = Object.keys(item).filter((c) => c !== columnToMatchOn);
			if (updateColumns.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					"No columns to update. Add values to update or set the 'Data Mode' to 'Define Below'.",
					{ itemIndex: i },
				);
			}

			const values: unknown[] = [];
			const setParts: string[] = [];
			let paramIndex = 1;
			for (const col of updateColumns) {
				setParts.push(`${quoteIdent(col)} = $${paramIndex}`);
				values.push(item[col]);
				paramIndex += 1;
			}

			const matchPlaceholder = `$${paramIndex}`;
			values.push(matchValue);
			paramIndex += 1;

			let query =
				`UPDATE ${quoteTable(schema, table)} SET ${setParts.join(', ')} ` +
				`WHERE ${quoteIdent(columnToMatchOn)} = ${matchPlaceholder}`;
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
			if (error instanceof NodeOperationError) throw error;
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
		}
	}

	return returnData;
}
