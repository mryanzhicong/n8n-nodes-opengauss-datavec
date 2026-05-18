import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { PoolClient } from 'pg';

import {
	addSortRules,
	addWhereClauses,
	parseOutputColumns,
	quoteIdentList,
	quoteTable,
} from '../../helpers/queryBuilder';
import type { SortRule, WhereClause } from '../../helpers/types';

const showOnSelect = { resource: ['database'], operation: ['select'] };

export const description: INodeProperties[] = [
	{
		displayName: 'Schema',
		name: 'schema',
		type: 'string',
		default: 'public',
		required: true,
		description: 'The schema that contains the table you want to read from',
		displayOptions: { show: showOnSelect },
	},
	{
		displayName: 'Table',
		name: 'table',
		type: 'string',
		default: '',
		required: true,
		description: 'The table you want to read from',
		displayOptions: { show: showOnSelect },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: showOnSelect },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		description: 'Max number of results to return',
		typeOptions: { minValue: 1 },
		displayOptions: {
			show: { ...showOnSelect, returnAll: [false] },
		},
	},
	{
		displayName: 'Select Rows',
		name: 'where',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Condition',
		default: {},
		description: 'If not set, all rows will be selected',
		displayOptions: { show: showOnSelect },
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
						placeholder: 'e.g. id',
					},
					{
						displayName: 'Operator',
						name: 'condition',
						type: 'options',
						options: [
							{ name: 'Equal', value: '=' },
							{ name: 'Not Equal', value: '!=' },
							{ name: 'Like', value: 'LIKE' },
							{ name: 'Not Like', value: 'NOT LIKE' },
							{ name: 'Greater Than', value: '>' },
							{ name: 'Less Than', value: '<' },
							{ name: 'Greater Than Or Equal', value: '>=' },
							{ name: 'Less Than Or Equal', value: '<=' },
							{ name: 'Is Null', value: 'IS NULL' },
							{ name: 'Is Not Null', value: 'IS NOT NULL' },
						],
						default: '=',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						displayOptions: {
							hide: { condition: ['IS NULL', 'IS NOT NULL'] },
						},
					},
				],
			},
		],
	},
	{
		displayName: 'Combine Conditions',
		name: 'combineConditions',
		type: 'options',
		options: [
			{ name: 'AND', value: 'AND', description: 'Rows must match all conditions' },
			{ name: 'OR', value: 'OR', description: 'Rows must match at least one condition' },
		],
		default: 'AND',
		displayOptions: { show: showOnSelect },
	},
	{
		displayName: 'Sort',
		name: 'sort',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Sort Rule',
		default: {},
		displayOptions: { show: showOnSelect },
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
					},
					{
						displayName: 'Direction',
						name: 'direction',
						type: 'options',
						options: [
							{ name: 'ASC', value: 'ASC' },
							{ name: 'DESC', value: 'DESC' },
						],
						default: 'ASC',
					},
				],
			},
		],
	},
];

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
			const outputColumnsRaw = parseOutputColumns(options.outputColumns);
			const outputColumns = outputColumnsRaw.length === 0 ? ['*'] : outputColumnsRaw;

			const tableSql = quoteTable(schema, table);
			const columnsSql = outputColumns.includes('*') ? '*' : quoteIdentList(outputColumns);
			let query = `SELECT ${columnsSql} FROM ${tableSql}`;
			const values: unknown[] = [];

			const whereRaw = (this.getNodeParameter('where', i, {}) as IDataObject).values as
				| WhereClause[]
				| undefined;
			const combineConditions = this.getNodeParameter('combineConditions', i, 'AND') as
				| 'AND'
				| 'OR';

			if (Array.isArray(whereRaw) && whereRaw.length > 0) {
				const whereResult = addWhereClauses(query, whereRaw, combineConditions, values.length + 1);
				query = whereResult.query;
				values.push(...whereResult.values);
			}

			const sortRaw = (this.getNodeParameter('sort', i, {}) as IDataObject).values as
				| SortRule[]
				| undefined;
			if (Array.isArray(sortRaw) && sortRaw.length > 0) {
				query = addSortRules(query, sortRaw);
			}

			const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
			if (!returnAll) {
				const limit = this.getNodeParameter('limit', i, 50) as number;
				values.push(limit);
				query += ` LIMIT $${values.length}`;
			}

			const result = await client.query(query, values);
			const rows = (result.rows ?? []) as IDataObject[];
			for (const row of rows) {
				returnData.push({ json: row, pairedItem: { item: i } });
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
