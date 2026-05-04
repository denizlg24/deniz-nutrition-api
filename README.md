# Deniz Nutrition API

Type-safe nutrition data API built with Bun, Elysia, Drizzle ORM, PostgreSQL, and Redis-backed rate limiting.

The API serves searchable food item summaries, barcode lookup, full nutrition data, and contribution endpoints for manually entered or OCR-extracted nutrition labels.

## Features

- Full-text item search by name and/or brand across `english`, `portuguese`, `spanish`, and `french`.
- Barcode and item ID lookup.
- Full nutrition data storage with quick item summaries derived from nutrition payloads.
- Redis-backed fixed-window rate limiting.
- Database-backed API keys for trusted clients that should bypass rate limits.
- PostgreSQL schema and migrations managed by Drizzle Kit.
- Global request IDs, structured JSON logs, centralized error responses, `/health`, and `/ready`.
- Type-safe OpenAPI documentation generated from Elysia schemas and TypeScript route types.
- Unit tests with Bun coverage.

## Tech Stack

- Runtime: Bun
- Framework: Elysia
- Database: PostgreSQL
- ORM: Drizzle ORM
- Cache/rate limits: Redis
- Language: TypeScript

## Requirements

- Bun 1.3+
- PostgreSQL database
- Redis, or Docker Compose for the bundled Redis service

## Environment

Create a local `.env` from the example:

```bash
cp .env.example .env
```

Required variables:

```env
API_PORT=3000
DATABASE_URL=postgres://postgres:postgres@localhost:5432/deniz_nutrition
REDIS_URL=redis://localhost:6379
```

Optional variables:

```env
NODE_ENV=development
LOG_LEVEL=info
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=60000
OCR_SERVICE_URL=
```

When using Docker Compose, `DATABASE_URL` is read from your `.env` file and `REDIS_URL` is set to the Compose Redis service automatically.

## Local Development

Install dependencies:

```bash
bun install
```

Run database migrations:

```bash
bun run db:migrate
```

Start the API in watch mode:

```bash
bun run dev
```

The API listens on `http://localhost:3000` by default.

OpenAPI documentation is available at:

- Scalar UI: `http://localhost:3000/openapi`
- Raw OpenAPI JSON: `http://localhost:3000/openapi/json`

## Docker Compose

Docker Compose starts the API and a Redis instance. PostgreSQL is not started by Compose because the API uses the `DATABASE_URL` already defined in your environment.

```bash
docker compose up -d --build
```

Useful commands:

```bash
docker compose logs -f api
docker compose ps
docker compose down
```

Run migrations before or after the container starts, using the same `.env`:

```bash
bun run db:migrate
```

## Scripts

```bash
bun run dev            # Start API in watch mode
bun run api-key:generate -- --name local-client # Create an API key
bun run import:openfoodfacts # Import OpenFoodFacts TSV export
bun run import:usda    # Import USDA FoodData Central JSON files
bun run import:usda:legacy # Import USDA SR Legacy JSON data
bun run start          # Start API
bun run typecheck      # Type-check the project
bun run test           # Run unit tests
bun run test:coverage  # Run tests with coverage
bun run db:generate    # Generate Drizzle migrations
bun run db:migrate     # Apply Drizzle migrations
```

## API Keys

Create a key with a human-readable name:

```bash
bun run api-key:generate -- --name "mobile-app"
```

Only the SHA-256 hash is stored in `api_keys`; the full key is printed once. Send it as either:

```http
x-api-key: dnut_...
authorization: Bearer dnut_...
```

Valid, non-revoked keys bypass Redis rate limits. Invalid or missing keys continue through normal rate limiting.

## USDA Import

The importer reads the USDA FoodData Central JSON files under `data/` without loading the full branded dataset into memory. It inserts by barcode when one exists and otherwise uses a stable synthetic barcode in the form `usda:{source}:{fdcId}`. Existing barcodes are skipped so earlier source data is not overwritten.

Import a bounded branded slice:

```bash
bun run import:usda -- --source branded --start 0 --limit 10000
```

Resume from the latest checkpoint:

```bash
bun run import:usda -- --source branded --resume
```

Import the smaller foundation dataset:

```bash
bun run import:usda -- --source foundation
```

Import the SR Legacy dataset:

```bash
bun run import:usda:legacy
```

Useful options:

```bash
--source foundation|branded|legacy|all
--start 50000
--limit 10000
--batch-size 500
--resume
--checkpoint .import-state/usda-import-checkpoint.json
--dry-run
```

The default checkpoint path is `.import-state/usda-import-checkpoint.json`, which is ignored by Git.

## OpenFoodFacts Import

The OpenFoodFacts importer reads `data/en.openfoodfacts.org.products.csv.gz` as a streaming gzipped TSV file. It inserts by product barcode, skips existing barcodes, maps available `*_100g` nutrition columns into the same item and nutrition tables, and scales values to the serving quantity when OpenFoodFacts provides one.

Import a bounded slice:

```bash
bun run import:openfoodfacts -- --start 0 --limit 10000
```

Resume from the latest checkpoint:

```bash
bun run import:openfoodfacts -- --resume
```

Useful options:

```bash
--file data/en.openfoodfacts.org.products.csv.gz
--start 50000
--limit 10000
--batch-size 500
--resume
--checkpoint .import-state/openfoodfacts-import-checkpoint.json
--dry-run
```

The default checkpoint path is `.import-state/openfoodfacts-import-checkpoint.json`, which is ignored by Git.

## API Overview

OpenAPI:

- `GET /openapi`
- `GET /openapi/json`

Health and readiness:

- `GET /health`
- `GET /ready`

Items:

- `GET /items/search?q={query}&brand={brand}&lang={lang}&minScore={score}&limit={limit}`
- `GET /items/barcode/{barcode}`
- `GET /items/{id}`
- `GET /items/{id}/nutrition`
- `POST /items`
- `PUT /items/{id}`
- `PUT /items/{id}/nutrition`
- `POST /items/scan`
- `POST /items/scan/confirm`

Item create requests accept core item identity plus a required `nutrition` payload. The item summary fields are calculated from that nutrition payload and refreshed whenever nutrition data is updated.

## Observability

Every request receives or reuses an `x-request-id`. Logs are emitted as structured JSON with method, path, status, duration, and request ID. Unexpected errors are logged centrally and returned as stable API error envelopes.

## Testing

Run all tests:

```bash
bun run test
```

Run coverage:

```bash
bun run test:coverage
```
