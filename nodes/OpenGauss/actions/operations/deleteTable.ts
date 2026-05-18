import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { PoolClient } from 'pg';

import { addWhereClauses, quoteTable } from '../../helpers/queryBuilder';
import type { WhereClause } from '../../helpers/types';

const showOnDelete = { resource: ['database'], operation: ['deleteTable'] };

export const description: INodeProperties[] = [
	{
		displayName: 'Schema',
		name: 'schema',
		type: 'string',
		default: 'public',
		required: true,
		displayOptions: { show: showOnDelete },
	},
	{
		displayName: 'Table',
		name: 'table',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: showOnDelete },
	},
	{
		displayName: 'Command',
		name: 'deleteCommand',
		type: 'options',
		default: 'truncate',
		options: [
			{
				name: 'Truncate',
				value: 'truncate',
				description: "Only removes the table's data, preserves the structure",
			},
			{
				name: 'Delete',
				value: 'delete',
				description: "Delete rows that match the 'Select Rows' conditions below",
			},
			{
				name: 'Drop',
				value: 'drop',
				description: "Permanently deletes the table's data and structure",
			},
		],
		displayOptions: { show: showOnDelete },
	},
	{
		displayName: 'Restart Sequences',
		name: 'restartSequences',
		type: 'boolean',
		default: false,
		description: 'Whether to reset identity (auto-increment) columns to their initial values',
		displayOptions: {
			show: { ...showOnDelete, deleteCommand: ['truncate'] },
		},
	},
	{
		displayName: 'Select Rows',
		name: 'where',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Condition',
		default: {},
		description: 'If not set, all rows will be deleted',
		displayOptions: {
			show: { ...showOnDelete, deleteCommand: ['delete'] },
		},
		options: [
			{
				displayName: 'Values',
				name: 'values',
				values: [
					{ displayName: 'Column', name: 'column', type: 'string', default: '' },
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
			{ name: 'AND', value: 'AND' },
			{ name: 'OR', value: 'OR' },
		],
		default: 'AND',
		displayOptions: {
			show: { ...showOnDelete, deleteCommand: ['delete'] },
		},
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
			const deleteCommand = this.getNodeParameter('deleteCommand', i) as string;
			const options = this.getNodeParameter('options', i, {}) as IDataObject;
			const cascade = options.cascade ? ' CASCADE' : '';

			const tableSql = quoteTable(schema, table);
			let query = '';
			let values: unknown[] = [];

			if (deleteCommand === 'drop') {
				query = `DROP TABLE IF EXISTS ${tableSql}${cascade}`;
			} else if (deleteCommand === 'truncate') {
				const restart = (this.getNodeParameter('restartSequences', i, false) as boolean)
					? ' RESTART IDENTITY'
					: '';
				query = `TRUNCATE TABLE ${tableSql}${restart}${cascade}`;
			} else if (deleteCommand === 'delete') {
				query = `DELETE FROM ${tableSql}`;
				const whereRaw = (this.getNodeParameter('where', i, {}) as IDataObject).values as
					| WhereClause[]
					| undefined;
				const combineConditions = this.getNodeParameter('combineConditions', i, 'AND') as
					| 'AND'
					| 'OR';
				if (Array.isArray(whereRaw) && whereRaw.length > 0) {
					const result = addWhereClauses(query, whereRaw, combineConditions, 1);
					query = result.query;
					values = result.values;
				}
			} else {
				throw new NodeOperationError(
					this.getNode(),
					`Invalid delete command '${deleteCommand}'`,
					{ itemIndex: i },
				);
			}

			const result = await client.query(query, values);
			returnData.push({
				json: { success: true, affectedRows: result.rowCount ?? 0 },
				pairedItem: { item: i },
			});
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
