# people-context

Central identity registry for the **ACDG Brasil** ecosystem (Associação Brasileira de Profissionais Atuantes em Doenças Genéticas). Registers person existence and tracks domain roles across systems.

## Purpose

> "Everything a system needs to operate lives inside that system. People Context only registers that a person exists and links them across systems."

This service answers one question: **does this person exist in the ACDG ecosystem, and what are they in each system?**

## Stack

| Component | Technology                                     |
| --------- | ---------------------------------------------- |
| Runtime   | Bun 1.3.14                                     |
| Language  | TypeScript 6.0                                 |
| HTTP      | Elysia 1.4.28                                  |
| Database  | PostgreSQL 15 (dedicated)                      |
| Events    | NATS JetStream (nats.js 2.29.3)                |
| Auth      | JWT RS256 via Authentik OIDC JWKS (jose 6.2.3) |
| Container | distroless + binário compilado (`--bytecode`)  |

## Quick Start

```bash
# Install dependencies
bun install

# Start PostgreSQL
docker compose up postgres -d

# Configure environment
cp .env.example .env

# Run in dev mode (hot reload)
bun run dev

# Run tests
bun test

# Type check
bun run typecheck
```

## API

| Method | Path                                       | Description                         | Auth                              |
| ------ | ------------------------------------------ | ----------------------------------- | --------------------------------- |
| GET    | `/health`                                  | Liveness probe                      | None                              |
| GET    | `/ready`                                   | Readiness probe (DB check)          | None                              |
| POST   | `/api/v1/people`                           | Register person (CPF dedup)         | `social_worker`, `admin`          |
| GET    | `/api/v1/people`                           | List people (paginated, searchable) | `social_worker`, `owner`, `admin` |
| GET    | `/api/v1/people/:id`                       | Get person by ID                    | `social_worker`, `owner`, `admin` |
| GET    | `/api/v1/people/by-cpf/:cpf`               | Find person by CPF                  | `social_worker`, `owner`, `admin` |
| PUT    | `/api/v1/people/:id`                       | Update person                       | `social_worker`, `admin`          |
| POST   | `/api/v1/people/:id/roles`                 | Assign system role                  | `social_worker`, `admin`          |
| GET    | `/api/v1/people/:id/roles`                 | List person roles                   | `social_worker`, `owner`, `admin` |
| PUT    | `/api/v1/people/:id/roles/:rid/deactivate` | Deactivate role                     | `admin`                           |
| PUT    | `/api/v1/people/:id/roles/:rid/reactivate` | Reactivate role                     | `admin`                           |
| GET    | `/api/v1/roles`                            | Query roles across people           | `social_worker`, `owner`, `admin` |

All mutation endpoints require `X-Actor-Id` header and Bearer JWT.

## Architecture

```
src/
├── config/       # Environment variables
├── domain/       # Types, branded types, validation (pure, no deps)
├── middleware/    # JWT/JWKS verification, RBAC guard
├── events/       # NATS publisher + event builders
├── repository/   # PostgreSQL queries (factory functions)
├── routes/       # Elysia handlers (thin, delegate to repository)
└── index.ts      # Composition root
```

100% functional TypeScript — no classes, no `any`, composition over inheritance.

## Docker

```bash
# Build
docker build -t people-context:local .

# Run with docker compose
docker compose up --build
```

## Contracts

API contracts are defined in the `contracts` repository:

- `services/people/openapi/openapi.yaml` — 12 endpoints (OpenAPI 3.1)
- `services/people/asyncapi/asyncapi.yaml` — 5 events (AsyncAPI 3.1)
- `services/people/model/schemas/` — 19 canonical YAML schemas

## License

[MIT](LICENSE)
