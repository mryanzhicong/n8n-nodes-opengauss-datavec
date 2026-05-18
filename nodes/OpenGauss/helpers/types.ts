import type { IDataObject } from 'n8n-workflow';

export type QueryValue = string | number | boolean | null | IDataObject | unknown;
export type QueryValues = QueryValue[];

export interface QueryWithValues {
	query: string;
	values: QueryValues;
}

export interface WhereClause {
	column: string;
	condition: string;
	value: string | number | boolean;
}

export interface SortRule {
	column: string;
	direction: 'ASC' | 'DESC';
}

export interface OpenGaussNodeOptions extends IDataObject {
	queryReplacement?: string;
	outputColumns?: string[];
	skipOnConflict?: boolean;
	cascade?: boolean;
	connectionTimeout?: number;
	largeNumbersOutput?: 'numbers' | 'text';
}

export interface OpenGaussCredentials {
	host: string;
	port: number;
	database: string;
	user: string;
	password: string;
	ssl?: 'disable' | 'allow' | 'require';
	maxConnections?: number;
}
