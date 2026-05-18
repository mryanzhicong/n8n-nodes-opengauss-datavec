import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class OpenGaussDataVec implements ICredentialType {
	name = 'openGaussDataVecApi';

	displayName = 'openGauss DataVec';

	documentationUrl = 'https://docs.opengauss.org/';

	// Connection test is handled via `testedBy: 'openGaussConnectionTest'`
	// in the node's credential declaration (INodeCredential.testedBy),
	// since database connections cannot use ICredentialTestRequest (HTTP-based).

	properties: INodeProperties[] = [
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'localhost',
			required: true,
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 5432,
			required: true,
		},
		{
			displayName: 'Database',
			name: 'database',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'User',
			name: 'user',
			type: 'string',
			default: 'gaussdb',
			required: true,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
		},
		{
			displayName: 'SSL',
			name: 'ssl',
			type: 'options',
			options: [
				{
					name: 'Disable',
					value: 'disable',
				},
				{
					name: 'Allow',
					value: 'allow',
				},
				{
					name: 'Require',
					value: 'require',
				},
			],
			default: 'disable',
		},
		{
			displayName: 'Max Connections',
			name: 'maxConnections',
			type: 'number',
			default: 10,
			description: 'Maximum number of connections in the pool',
		},
	];
}
