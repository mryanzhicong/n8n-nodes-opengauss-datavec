import {
	NodeConnectionTypes,
	type ICredentialTestFunctions,
	type ICredentialsDecrypted,
	type IExecuteFunctions,
	type INodeCredentialTestResult,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type INodeProperties,
} from 'n8n-workflow';

import {
	DataVecClient,
	type DataVecConfig,
	type DistanceStrategy,
	type IndexType,
} from './datavecClient';

// ============================================================
// Operation Definitions
// ============================================================

const distanceStrategyOptions: INodeProperties = {
	displayName: 'Distance Strategy',
	name: 'distanceStrategy',
	type: 'options',
	options: [
		{
			name: 'L2',
			value: 'l2',
			description: 'Euclidean L2 distance',
		},
		{
			name: 'Cosine',
			value: 'cosine',
			description: 'Cosine distance',
		},
		{
			name: 'Inner Product',
			value: 'inner_product',
			description: 'Inner product distance',
		},
		{
			name: 'Manhattan',
			value: 'manhattan',
			description: 'Manhattan L1 distance',
		},
	],
	default: 'cosine',
	description: 'Distance strategy for vector comparison',
};

const operations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'Vector Search',
				value: 'vectorSearch',
				description: 'Search for similar vectors',
				action: 'Search for similar vectors',
			},
			{
				name: 'Insert Documents',
				value: 'insertDocuments',
				description: 'Insert documents and vectors',
				action: 'Insert documents and vectors',
			},
			{
				name: 'Create Index',
				value: 'createIndex',
				description: 'Create a vector index',
				action: 'Create a vector index',
			},
			{
				name: 'Execute Query',
				value: 'executeQuery',
				description: 'Execute a custom SQL query',
				action: 'Execute a custom SQL query',
			},
		],
		default: 'vectorSearch',
	},
];

// ============================================================
// Vector Search Parameters
// ============================================================

const vectorSearchParameters: INodeProperties[] = [
	{
		displayName: 'Table Name',
		name: 'tableName',
		type: 'string',
		required: true,
		default: '',
		description: 'Name of the table to search in',
	},
	{
		displayName: 'Query Vector',
		name: 'queryVector',
		type: 'string',
		required: true,
		default: '',
		placeholder: '[0.1, 0.2, 0.3, ...]',
		description: 'Vector to search for, as a JSON array of numbers',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 10,
		description: 'Maximum number of results to return',
	},
	{
		...distanceStrategyOptions,
		displayOptions: {
			show: {
				operation: ['vectorSearch'],
			},
		},
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				operation: ['vectorSearch'],
			},
		},
		options: [
			{
				displayName: 'EF Search',
				name: 'efSearch',
				type: 'number',
				default: undefined,
				description: 'HNSW ef_search parameter',
			},
			{
				displayName: 'Probes',
				name: 'probes',
				type: 'number',
				default: undefined,
				description: 'IVFFLAT probes parameter',
			},
			{
				displayName: 'Metadata Filter',
				name: 'metadataFilter',
				type: 'string',
				default: '',
				placeholder: '{"key": "value"}',
				description: 'JSON metadata filter',
			},
		],
	},
];

// ============================================================
// Insert Documents Parameters
// ============================================================

const insertDocumentsParameters: INodeProperties[] = [
	{
		displayName: 'Table Name',
		name: 'tableName',
		type: 'string',
		required: true,
		default: '',
		description: 'Name of the table to insert into',
	},
	{
		displayName: 'Documents',
		name: 'documents',
		type: 'fixedCollection',
		typeOptions: {
			multipleValues: true,
		},
		default: {},
		placeholder: 'Add Document',
		description: 'Documents to insert with embeddings',
		displayOptions: {
			show: {
				operation: ['insertDocuments'],
			},
		},
		options: [
			{
				name: 'documentValues',
				displayName: 'Document',
				values: [
					{
						displayName: 'Content',
						name: 'content',
						type: 'string',
						required: true,
						default: '',
						description: 'Text content of the document',
					},
					{
						displayName: 'Embedding',
						name: 'embedding',
						type: 'string',
						required: true,
						default: '',
						placeholder: '[0.1, 0.2, 0.3, ...]',
						description: 'Vector embedding as a JSON array of numbers',
					},
					{
						displayName: 'Metadata',
						name: 'metadata',
						type: 'string',
						default: '',
						placeholder: '{"key": "value"}',
						description: 'JSON metadata for the document',
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				operation: ['insertDocuments'],
			},
		},
		options: [
			{
				displayName: 'Create Table If Not Exists',
				name: 'createTableIfNotExists',
				type: 'boolean',
				default: true,
				description: 'Whether to create the table if it does not exist',
			},
			{
				displayName: 'Dimensions',
				name: 'dimensions',
				type: 'number',
				default: undefined,
				description: 'Vector dimensions, required if creating table',
			},
		],
	},
];

// ============================================================
// Create Index Parameters
// ============================================================

const createIndexParameters: INodeProperties[] = [
	{
		displayName: 'Table Name',
		name: 'tableName',
		type: 'string',
		required: true,
		default: '',
		description: 'Name of the table to create the index on',
	},
	{
		displayName: 'Index Type',
		name: 'indexType',
		type: 'options',
		options: [
			{
				name: 'HNSW',
				value: 'hnsw',
				description: 'Hierarchical Navigable Small World graph index',
			},
			{
				name: 'IVFFLAT',
				value: 'ivfflat',
				description: 'Inverted File with Flat compression index',
			},
			{
				name: 'DISKANN',
				value: 'diskann',
				description: 'Disk-based Approximate Nearest Neighbor index',
			},
		],
		default: 'hnsw',
		description: 'Type of vector index to create',
	},
	{
		...distanceStrategyOptions,
		displayOptions: {
			show: {
				operation: ['createIndex'],
			},
		},
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: {
			show: {
				operation: ['createIndex'],
			},
		},
		options: [
			{
				displayName: 'Index Name',
				name: 'indexName',
				type: 'string',
				default: '',
				description: 'Custom name for the index',
			},
			{
				displayName: 'M',
				name: 'm',
				type: 'number',
				default: 16,
				description: 'HNSW M parameter (max connections per layer)',
				displayOptions: {
					show: {
						'/indexType': ['hnsw'],
					},
				},
			},
			{
				displayName: 'EF Construction',
				name: 'efConstruction',
				type: 'number',
				default: 64,
				description: 'HNSW ef_construction parameter (build-time search width)',
				displayOptions: {
					show: {
						'/indexType': ['hnsw'],
					},
				},
			},
			{
				displayName: 'Lists',
				name: 'lists',
				type: 'number',
				default: 100,
				description: 'IVFFLAT lists parameter (number of clusters)',
				displayOptions: {
					show: {
						'/indexType': ['ivfflat'],
					},
				},
			},
		],
	},
];

// ============================================================
// Execute Query Parameters
// ============================================================

const executeQueryParameters: INodeProperties[] = [
	{
		displayName: 'Query',
		name: 'query',
		type: 'string',
		required: true,
		typeOptions: {
			rows: 5,
			editor: 'sqlEditor',
		},
		default: '',
		description: 'SQL query to execute',
	},
];

// ============================================================
// All Properties (with displayOptions for each operation)
// ============================================================

function withOperationDisplayOptions(
	params: INodeProperties[],
	operationsList: string[],
): INodeProperties[] {
	return params.map((param) => {
		// Skip the operation selector itself
		if (param.name === 'operation') return param;
		// Skip parameters that already have their own displayOptions
		if (param.displayOptions?.show?.operation) return param;

		return {
			...param,
			displayOptions: {
				show: {
					operation: operationsList,
					...(param.displayOptions?.show ?? {}),
				},
			},
		};
	});
}

const allProperties: INodeProperties[] = [
	...operations,
	...withOperationDisplayOptions(vectorSearchParameters, ['vectorSearch']),
	...withOperationDisplayOptions(insertDocumentsParameters, ['insertDocuments']),
	...withOperationDisplayOptions(createIndexParameters, ['createIndex']),
	...withOperationDisplayOptions(executeQueryParameters, ['executeQuery']),
];

// ============================================================
// Node Description
// ============================================================

const nodeDescription: INodeTypeDescription = {
	displayName: 'OpenGauss DataVec',
	name: 'openGaussDataVec',
	icon: 'file:opengauss.svg',
	group: ['transform'],
	version: 1,
	subtitle: '={{ $parameter["operation"] }}',
	description: 'Interact with openGauss DataVec vector database',
	defaults: {
		name: 'OpenGauss DataVec',
	},
	inputs: [NodeConnectionTypes.Main],
	outputs: [NodeConnectionTypes.Main],
	credentials: [
		{
			name: 'openGaussDataVecApi',
			required: true,
			testedBy: 'openGaussConnectionTest',
		},
	],
	properties: allProperties,
};

// ============================================================
// Node Implementation
// ============================================================

export class VectorStoreOpenGauss implements INodeType {
	description: INodeTypeDescription = nodeDescription;

	methods = {
		credentialTest: {
			async openGaussConnectionTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const creds = credential.data as {
					host: string;
					port: number;
					database: string;
					user: string;
					password: string;
					ssl?: string;
					maxConnections?: number;
				};

				const sslConfig =
					creds.ssl === 'require' ? true : creds.ssl === 'disable' || creds.ssl === 'allow' ? false : undefined;

				const config: DataVecConfig = {
					host: creds.host,
					port: creds.port,
					database: creds.database,
					user: creds.user,
					password: creds.password,
					ssl: sslConfig,
					maxConnections: creds.maxConnections,
				};

				const client = new DataVecClient(config);
				try {
					await client.connect();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						status: 'Error',
						message,
					};
				} finally {
					await client.close();
				}

				return {
					status: 'OK',
					message: 'Connection successful!',
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const operation = this.getNodeParameter('operation', 0) as string;

		// Get credentials
		const credentials = await this.getCredentials('openGaussDataVecApi');

		const sslConfig =
			credentials.ssl === 'require'
				? true
				: credentials.ssl === 'disable' || credentials.ssl === 'allow'
					? false
					: undefined;

		const config: DataVecConfig = {
			host: credentials.host as string,
			port: credentials.port as number,
			database: credentials.database as string,
			user: credentials.user as string,
			password: credentials.password as string,
			ssl: sslConfig,
			maxConnections: credentials.maxConnections as number | undefined,
		};

		const client = new DataVecClient(config);

		try {
			for (let i = 0; i < items.length; i++) {
				try {
					switch (operation) {
						case 'vectorSearch': {
							const tableName = this.getNodeParameter('tableName', i) as string;
							const queryVectorStr = this.getNodeParameter('queryVector', i) as string;
							const limit = this.getNodeParameter('limit', i) as number;
							const distanceStrategy = this.getNodeParameter('distanceStrategy', i) as DistanceStrategy;
							const options = this.getNodeParameter('options', i, {}) as {
								efSearch?: number;
								probes?: number;
								metadataFilter?: string;
							};

							let queryVector: number[];
							try {
								queryVector = JSON.parse(queryVectorStr);
							} catch {
								throw new Error(
									'Invalid query vector format. Expected a JSON array of numbers, e.g. [0.1, 0.2, 0.3]',
								);
							}

							let filter: Record<string, unknown> | undefined;
							if (options.metadataFilter) {
								try {
									filter = JSON.parse(options.metadataFilter);
								} catch {
									throw new Error(
										'Invalid metadata filter format. Expected a JSON object, e.g. {"key": "value"}',
									);
								}
							}

							const results = await client.similaritySearch({
								tableName,
								queryVector,
								limit,
								distanceStrategy,
								filter,
								efSearch: options.efSearch,
								probes: options.probes,
							});

							for (const result of results) {
								returnData.push({
									json: {
										id: result.id,
										content: result.content,
										metadata: result.metadata,
										distance: result.distance,
									},
									pairedItem: { item: i },
								});
							}
							break;
						}

						case 'insertDocuments': {
							const tableName = this.getNodeParameter('tableName', i) as string;
							const documentsData = this.getNodeParameter('documents', i) as {
								documentValues?: Array<{
									content: string;
									embedding: string;
									metadata?: string;
								}>;
							};
							const options = this.getNodeParameter('options', i, {}) as {
								createTableIfNotExists?: boolean;
								dimensions?: number;
							};

							const docValues = documentsData.documentValues ?? [];
							const documents = docValues.map((doc) => {
								let embedding: number[];
								try {
									embedding = JSON.parse(doc.embedding);
								} catch {
									throw new Error(
										`Invalid embedding format for document. Expected a JSON array of numbers`,
									);
								}

								let metadata: Record<string, unknown> | undefined;
								if (doc.metadata) {
									try {
										metadata = JSON.parse(doc.metadata);
									} catch {
										throw new Error(
											`Invalid metadata format for document. Expected a JSON object`,
										);
									}
								}

								return {
									content: doc.content,
									embedding,
									metadata,
								};
							});

							// Create table if needed
							if (options.createTableIfNotExists !== false) {
								const dimensions = options.dimensions;
								if (!dimensions && documents.length > 0) {
									// Infer dimensions from the first document's embedding
									const inferredDimensions = documents[0].embedding.length;
									await client.createTable({
										tableName,
										dimensions: inferredDimensions,
										ifNotExists: true,
									});
								} else if (dimensions) {
									await client.createTable({
										tableName,
										dimensions,
										ifNotExists: true,
									});
								}
							}

							const insertedCount = await client.insertDocuments({
								tableName,
								documents,
							});

							returnData.push({
								json: {
									insertedCount,
									tableName,
								},
								pairedItem: { item: i },
							});
							break;
						}

						case 'createIndex': {
							const tableName = this.getNodeParameter('tableName', i) as string;
							const indexType = this.getNodeParameter('indexType', i) as IndexType;
							const distanceStrategy = this.getNodeParameter(
								'distanceStrategy',
								i,
							) as DistanceStrategy;
							const options = this.getNodeParameter('options', i, {}) as {
								indexName?: string;
								m?: number;
								efConstruction?: number;
								lists?: number;
							};

							await client.createIndex({
								tableName,
								indexType,
								distanceStrategy,
								indexName: options.indexName || undefined,
								m: options.m,
								efConstruction: options.efConstruction,
								lists: options.lists,
							});

							returnData.push({
								json: {
									success: true,
									tableName,
									indexType,
									distanceStrategy,
									indexName: options.indexName || `${tableName}_embedding_idx`,
								},
								pairedItem: { item: i },
							});
							break;
						}

						case 'executeQuery': {
							const query = this.getNodeParameter('query', i) as string;

							const rows = await client.executeQuery(query);

							for (const row of rows as Array<Record<string, unknown>>) {
								returnData.push({
									json: row as { [key: string]: string | number | boolean | object | null | undefined },
									pairedItem: { item: i },
								});
							}
							break;
						}

						default:
							throw new Error(`Unknown operation: ${operation}`);
					}
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: {
								error: error instanceof Error ? error.message : String(error),
							},
							pairedItem: { item: i },
						});
						continue;
					}
					throw error;
				}
			}
		} finally {
			await client.close();
		}

		return [returnData];
	}
}
