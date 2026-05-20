# n8n-nodes-opengauss-datavec

An n8n community node package for openGauss DataVec — provides both an **AI Vector Store** node for RAG/agent workflows and a **general-purpose SQL** node for standard database operations.

## Features

### Vector Store Node (`openGauss DataVec Store`)

AI Vector Store sub-node that integrates with n8n AI Agent, Retriever, and other LangChain nodes.

- **Get Many** — Vector similarity search, returns Top-K results
- **Insert Documents** — Insert documents with embeddings (auto-creates table on first run)
- **Retrieve Documents (As Vector Store)** — Use as a Vector Store Retriever sub-node
- **Retrieve Documents (As Tool for AI Agent)** — Use as an AI Agent tool node

Configurable: Schema, Table, Dimensions, Distance Strategy, Top K, Metadata Filter.

### SQL Node (`openGauss`)

General-purpose execution node for standard database operations.

- **Execute SQL** — Run arbitrary SQL queries
- **Insert / Update / Upsert / Delete / Select** — CRUD operations with a visual UI

Configurable: Schema, Table, Columns, WHERE conditions, etc.

## Supported Distance Metrics

| Metric | Description |
|--------|-------------|
| L2 | Euclidean distance |
| Cosine | Cosine similarity |
| Inner Product | Dot product similarity |
| Manhattan | Manhattan (L1) distance |

## Supported Index Types

| Index | Description |
|-------|-------------|
| HNSW | Hierarchical Navigable Small World graph index |
| IVFFLAT | Inverted file with flat quantization |
| DISKANN | Disk-based approximate nearest neighbor |

## Prerequisites

- openGauss 7.0+ with DataVec extension enabled
- n8n instance (self-hosted or cloud)

## Installation

### Via n8n Community Nodes

1. Go to **Settings > Community Nodes** in your n8n instance
2. Search for `n8n-nodes-opengauss-datavec`
3. Click **Install**

### Via npm

```bash
npm install n8n-nodes-opengauss-datavec
```

## Quick Start

See [docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md) for detailed usage instructions and workflow examples.

## Credentials

Both nodes share the **openGauss DataVec** credential (Host, Port, Database, User, Password).

## License

[MIT](LICENSE)
