import type { QueryValues, SortRule, WhereClause } from './types';

/**
 * Quote a SQL identifier (schema/table/column name) by wrapping in double quotes
 * and escaping inner double quotes by doubling them. Equivalent to PostgreSQL's
 * quote_ident().
 */
export function quoteIdent(name: string): string {
	if (name === undefined || name === null) {
		throw new Error('Identifier cannot be empty');
	}
	const str = String(name);
	if (str.length === 0) {
		throw new Error('Identifier cannot be empty');
	}
	return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Quote a fully qualified table name: "schema"."table".
 */
export function quoteTable(schema: string, table: string): string {
	return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

/**
 * Quote a list of column names and join with commas: "c1","c2","c3".
 */
export function quoteIdentList(names: string[]): string {
	return names.map((n) => quoteIdent(n)).join(', ');
}

/**
 * Append a RETURNING clause based on requested output columns.
 * If '*' is included, returns RETURNING *. Otherwise quotes each column.
 */
export function addReturning(query: string, outputColumns: string[]): string {
	if (!outputColumns || outputColumns.length === 0) {
		return query;
	}
	if (outputColumns.includes('*')) {
		return `${query} RETURNING *`;
	}
	return `${query} RETURNING ${quoteIdentList(outputColumns)}`;
}

/**
 * Append WHERE clauses to a query and return the augmented query plus the
 * values that should be appended to the parameter array.
 *
 * `startParamIndex` is the 1-based index of the first new $N placeholder.
 * Identifiers are inlined (quoted) since pg doesn't support identifier
 * placeholders.
 */
export function addWhereClauses(
	query: string,
	clauses: WhereClause[],
	combine: 'AND' | 'OR',
	startParamIndex: number,
): { query: string; values: QueryValues } {
	if (!clauses || clauses.length === 0) {
		return { query, values: [] };
	}

	const combineWith = combine === 'OR' ? 'OR' : 'AND';
	const values: QueryValues = [];
	let paramIndex = startParamIndex;
	let whereQuery = ' WHERE';

	clauses.forEach((clauseRaw, index) => {
		const clause: WhereClause = { ...clauseRaw };
		if (clause.condition === 'equal') {
			clause.condition = '=';
		}

		if (['>', '<', '>=', '<='].includes(clause.condition)) {
			const numericValue = Number(clause.value);
			if (String(clause.value).trim() !== '' && !Number.isNaN(numericValue)) {
				clause.value = numericValue;
			}
		}

		const columnSql = quoteIdent(clause.column);

		let valuePlaceholder = '';
		if (clause.condition !== 'IS NULL' && clause.condition !== 'IS NOT NULL') {
			valuePlaceholder = ` $${paramIndex}`;
			values.push(clause.value);
			paramIndex += 1;
		}

		const joiner = index === clauses.length - 1 ? '' : ` ${combineWith}`;
		whereQuery += ` ${columnSql} ${clause.condition}${valuePlaceholder}${joiner}`;
	});

	return { query: query + whereQuery, values };
}

/**
 * Append ORDER BY clauses (no parameters; identifiers are inlined and quoted).
 */
export function addSortRules(query: string, rules: SortRule[]): string {
	if (!rules || rules.length === 0) {
		return query;
	}

	const parts: string[] = rules.map((rule) => {
		const direction = rule.direction === 'DESC' ? 'DESC' : 'ASC';
		return `${quoteIdent(rule.column)} ${direction}`;
	});

	return `${query} ORDER BY ${parts.join(', ')}`;
}

/**
 * Build the columns + values portion for INSERT.
 *
 * Given an item like { c1: v1, c2: v2 } and a startParamIndex, returns:
 *   columnsSql:  `"c1", "c2"`
 *   valuesSql:   `$N, $N+1`
 *   values:      [v1, v2]
 */
export function buildInsertColumns(
	item: Record<string, unknown>,
	startParamIndex: number,
): { columns: string[]; columnsSql: string; valuesSql: string; values: QueryValues } {
	const columns = Object.keys(item);
	const values: QueryValues = [];
	const placeholders: string[] = [];
	let paramIndex = startParamIndex;
	for (const col of columns) {
		placeholders.push(`$${paramIndex}`);
		values.push(item[col]);
		paramIndex += 1;
	}
	return {
		columns,
		columnsSql: quoteIdentList(columns),
		valuesSql: placeholders.join(', '),
		values,
	};
}

/**
 * Parse the user-provided 'outputColumns' option into a list of column names.
 * Accepts a comma-separated string or an array; an empty/undefined value yields [].
 */
export function parseOutputColumns(value: unknown): string[] {
	if (value === undefined || value === null || value === '') return [];
	if (Array.isArray(value)) {
		return value.map((v) => String(v).trim()).filter((v) => v.length > 0);
	}
	return String(value)
		.split(',')
		.map((v) => v.trim())
		.filter((v) => v.length > 0);
}

/**
 * Convenience: quote each item value if it's an object and stringify (for JSON columns).
 * pg driver handles JSON serialisation when the parameter is an object, but if the
 * caller already has a string we leave it alone.
 */
export function normaliseJsonValue(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === 'object') {
		return JSON.stringify(value);
	}
	return value;
}
