# openGauss DataVec Vector Store Node for n8n

An n8n community node for interacting with openGauss DataVec vector database, enabling vector similarity search and document management within n8n workflows.

## Features

- **Vector Similarity Search** — Query documents by vector similarity with configurable top-K results
- **Document Insert** — Insert documents with embeddings into openGauss DataVec tables
- **Index Management** — Create, rebuild, and drop vector indexes on your tables
- **Custom Query** — Execute raw SQL queries against your DataVec-enabled tables

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

## License

[MIT](LICENSE)
