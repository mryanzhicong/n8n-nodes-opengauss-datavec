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
	type ISupplyDataFunctions,
	type SupplyData,
} from 'n8n-workflow';

import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { Document } from '@langchain/core/documents';
import { DynamicTool } from '@langchain/core/tools';

import {
	DataVecClient,
	type DataVecConfig,
	type DistanceStrategy,
} from './datavecClient';

import { OpenGaussVectorStore, type OpenGaussVectorStoreConfig } from './OpenGaussVectorStore';

// ============================================================
// Mode Property
// ============================================================

const modeProperty: INodeProperties = {
	displayName: 'Mode',
	name: 'mode',
	type: 'options',
	noDataExpression: true,
	options: [
		{
			name: 'Get Many',
			value: 'load',
			description: 'Get many ranked documents from vector store for use in a data pipeline',
			action: 'Get many ranked documents from vector store',
		},
		{
			name: 'Insert Documents',
			value: 'insert',
			description: 'Insert documents into vector store',
			action: 'Insert documents into vector store',
		},
		{
			name: 'Retrieve Documents (As Vector Store)',
			value: 'retrieve',
			description: 'Retrieve documents from vector store to provide to AI nodes',
			action: 'Retrieve documents for AI processing',
		},
		{
			name: 'Retrieve Documents (As Tool for AI Agent)',
			value: 'retrieve-as-tool',
			description: 'Retrieve documents from vector store to use as a tool with an AI agent',
			action: 'Retrieve documents as tool for AI agent',
		},
	],
	default: 'retrieve',
};

// ============================================================
// Shared Parameters
// ============================================================

const tableNameProperty: INodeProperties = {
	displayName: 'Table Name',
	name: 'tableName',
	type: 'string',
	required: true,
	default: '',
	description: 'Name of the vector table',
};

const distanceStrategyProperty: INodeProperties = {
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

const dimensionsProperty: INodeProperties = {
	displayName: 'Dimensions',
	name: 'dimensions',
	type: 'number',
	default: undefined,
	description: 'Vector dimensions, required if creating table',
	displayOptions: {
		show: {
			mode: ['insert'],
		},
	},
};

const promptProperty: INodeProperties = {
	displayName: 'Prompt',
	name: 'prompt',
	type: 'string',
	default: '',
	required: true,
	description: 'Search prompt to retrieve matching documents',
	displayOptions: {
		show: {
			mode: ['load'],
		},
	},
};

const toolDescriptionProperty: INodeProperties = {
	displayName: 'Tool Description',
	name: 'toolDescription',
	type: 'string',
	default: 'Search in openGauss DataVec vector store',
	required: true,
	description: 'Description of this tool for the AI agent',
	displayOptions: {
		show: {
			mode: ['retrieve-as-tool'],
		},
	},
};

const metadataFilterProperty: INodeProperties = {
	displayName: 'Metadata Filter',
	name: 'metadataFilter',
	type: 'string',
	default: '',
	placeholder: '{"key": "value"}',
	description: 'JSON metadata filter for search results',
	displayOptions: {
		show: {
			mode: ['load', 'retrieve', 'retrieve-as-tool'],
		},
	},
};

const topKProperty: INodeProperties = {
	displayName: 'Top K',
	name: 'topK',
	type: 'number',
	default: 10,
	description: 'Number of results to return',
	displayOptions: {
		show: {
			mode: ['load', 'retrieve', 'retrieve-as-tool'],
		},
	},
};

// ============================================================
// All Properties
// ============================================================

const allProperties: INodeProperties[] = [
	modeProperty,
	tableNameProperty,
	distanceStrategyProperty,
	promptProperty,
	toolDescriptionProperty,
	topKProperty,
	dimensionsProperty,
	metadataFilterProperty,
];

// ============================================================
// Node Description
// ============================================================

const nodeDescription: INodeTypeDescription = {
	displayName: 'OpenGauss DataVec Vector Store',
	name: 'openGaussDataVec',
	icon: 'file:opengauss.svg',
	group: ['transform'],
	version: 1,
	subtitle: '= {"load": "Get Many", "insert": "Insert Documents", "retrieve": "Retrieve (Vector Store)", "retrieve-as-tool": "Retrieve (Tool)"}[$parameter["mode"]] ',
	description: 'Work with openGauss DataVec vector database',
	defaults: {
		name: 'OpenGauss DataVec Vector Store',
	},
	inputs: `={{
		((parameter) => {
			const mode = parameter?.mode;
			const inputs = [{ displayName: 'Embedding', type: 'ai_embedding', required: true, maxConnections: 1 }];
			if (mode === 'insert' || mode === 'load') {
				inputs.unshift({ displayName: '', type: 'main' });
			}
			return inputs;
		})($parameter)
	}}`,
	outputs: `={{
		((parameter) => {
			const mode = parameter?.mode;
			if (mode === 'insert' || mode === 'load') {
				return [{ displayName: '', type: 'main' }];
			}
			if (mode === 'retrieve-as-tool') {
				return [{ displayName: 'Tool', type: 'ai_tool' }];
			}
			return [{ displayName: 'Vector Store', type: 'ai_vectorStore' }];
		})($parameter)
	}}`,
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

	async supplyData(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData> {
		const credentials = await this.getCredentials('openGaussDataVecApi');

		const sslConfig =
			credentials.ssl === 'require' ? true
			: credentials.ssl === 'disable' || credentials.ssl === 'allow' ? false
			: undefined;

		const tableName = this.getNodeParameter('tableName', itemIndex) as string;
		const distanceStrategy = this.getNodeParameter('distanceStrategy', itemIndex) as DistanceStrategy;
		const topK = this.getNodeParameter('topK', itemIndex, 10) as number;
		const metadataFilterStr = this.getNodeParameter('metadataFilter', itemIndex, '') as string;

		let filter: Record<string, unknown> | undefined;
		if (metadataFilterStr) {
			try {
				filter = JSON.parse(metadataFilterStr);
			} catch {
				throw new Error('Invalid metadata filter format. Expected a JSON object, e.g. {"key": "value"}');
			}
		}

		const connectionConfig: DataVecConfig = {
			host: credentials.host as string,
			port: credentials.port as number,
			database: credentials.database as string,
			user: credentials.user as string,
			password: credentials.password as string,
			ssl: sslConfig,
			maxConnections: credentials.maxConnections as number | undefined,
		};

		const embeddings = (await this.getInputConnectionData(
			NodeConnectionTypes.AiEmbedding,
			itemIndex,
		)) as EmbeddingsInterface;

		const config: OpenGaussVectorStoreConfig = {
			connectionConfig,
			tableName,
			distanceStrategy,
		};

		const vectorStore = new OpenGaussVectorStore(embeddings, config);

		const mode = this.getNodeParameter('mode', itemIndex) as string;

		if (mode === 'retrieve-as-tool') {
			const toolDescription = this.getNodeParameter('toolDescription', itemIndex) as string;
			const nodeName = this.getNode().name;

			const tool = new DynamicTool({
				name: nodeName.replace(/\s/g, '_'),
				description: toolDescription,
				func: async (query: string) => {
					const docs = await vectorStore.similaritySearch(query, topK, filter);
					return docs.map((d) => d.pageContent).join('\n\n');
				},
			});

			return { response: tool };
		}

		return { response: vectorStore };
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('openGaussDataVecApi');
		const sslConfig =
			credentials.ssl === 'require' ? true
			: credentials.ssl === 'disable' || credentials.ssl === 'allow' ? false
			: undefined;

		const tableName = this.getNodeParameter('tableName', 0) as string;
		const distanceStrategy = this.getNodeParameter('distanceStrategy', 0) as DistanceStrategy;

		const connectionConfig: DataVecConfig = {
			host: credentials.host as string,
			port: credentials.port as number,
			database: credentials.database as string,
			user: credentials.user as string,
			password: credentials.password as string,
			ssl: sslConfig,
			maxConnections: credentials.maxConnections as number | undefined,
		};

		const embeddings = (await (this as unknown as ISupplyDataFunctions).getInputConnectionData(
			NodeConnectionTypes.AiEmbedding,
			0,
		)) as EmbeddingsInterface;

		const config: OpenGaussVectorStoreConfig = {
			connectionConfig,
			tableName,
			distanceStrategy,
		};

		const mode = this.getNodeParameter('mode', 0) as string;

		if (mode === 'load') {
			const prompt = this.getNodeParameter('prompt', 0) as string;
			const topK = this.getNodeParameter('topK', 0, 10) as number;
			const metadataFilterStr = this.getNodeParameter('metadataFilter', 0, '') as string;

			let filter: Record<string, unknown> | undefined;
			if (metadataFilterStr) {
				try {
					filter = JSON.parse(metadataFilterStr);
				} catch {
					throw new Error('Invalid metadata filter format. Expected a JSON object, e.g. {"key": "value"}');
				}
			}

			const vectorStore = new OpenGaussVectorStore(embeddings, config);

			try {
				const queryVector = await embeddings.embedQuery(prompt);
				const results = await vectorStore.similaritySearchVectorWithScore(queryVector, topK, filter);

				for (const [doc, score] of results) {
					returnData.push({
						json: {
							pageContent: doc.pageContent,
							metadata: doc.metadata,
							score,
						},
					});
				}
			} finally {
				await vectorStore.close();
			}
		} else if (mode === 'insert') {
			const dimensions = this.getNodeParameter('dimensions', 0, undefined) as number | undefined;
			config.dimensions = dimensions;

			const vectorStore = new OpenGaussVectorStore(embeddings, config);

			try {
				const documents: Document[] = [];
				for (let i = 0; i < items.length; i++) {
					const item = items[i];
					const pageContent = (item.json.content as string) ||
										(item.json.text as string) ||
										(item.json.pageContent as string) ||
										JSON.stringify(item.json);
					const metadata = (item.json.metadata as Record<string, unknown>) || {};
					documents.push(new Document({ pageContent, metadata }));
				}

				await vectorStore.addDocuments(documents);

				returnData.push({
					json: {
						success: true,
						insertedCount: documents.length,
						tableName,
					},
				});
			} finally {
				await vectorStore.close();
			}
		}

		return [returnData];
	}
}
