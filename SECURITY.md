# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Do NOT open a public issue.**

Instead, send an email to **security@acdgbrasil.com.br** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a timeline for resolution.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Security Practices

- JWT RS256 verification via Zitadel JWKS
- RBAC enforcement on all endpoints
- Token introspection fallback with explicit service account allowlist
- X-Actor-Id required on all mutation endpoints
- Parameterized SQL queries (no string concatenation)
- Secrets managed via Bitwarden Secrets Manager (never in Git)
- Database-per-service isolation
