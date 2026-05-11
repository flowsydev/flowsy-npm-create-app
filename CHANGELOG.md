# Changelog

All notable changes to this project will be documented in this file.

## [2.0.1] - 2026-05-10

### Fixed

- `infra-kit` service name prompts now consistently reject unversioned service names
  and point users to the generated versioned default.
- Service name defaults now share a single helper across create, add and edit flows.

### Changed

- Copilot repository instructions now reference the active `infra-kit` template.
- Ignore local `.claude/` workspace files.

## [2.0.0] - 2026-05-03

### Added

- `infra-kit` template: interactive Docker Compose generator supporting PostgreSQL, MySQL,
  MariaDB, SQL Server, Redis, Keycloak, Apache Kafka, Kafka UI, Redpanda, Redpanda Console,
  RabbitMQ and Mailpit.
- Service name prompt per instance: the user can set the compose service identifier
  independently of the Docker image tag (default: `{image}-{major}`, e.g. `postgres-18`),
  so minor/patch upgrades don't require renaming running services.
- `extractMajorVersion` helper to derive the default service name from an image tag.
- Dynamic template-loading architecture in the CLI: each template exposes `collectConfig`,
  `configure` and `parseExistingCompose` hooks loaded at runtime from `config.js`.
- Update mode for `infra-kit`: detects an existing `compose.yml`, diffs current vs. desired
  services, and applies incremental changes without regenerating the full file.
- Pinned default Docker image versions for all supported services (no floating `latest` tags):
  PostgreSQL 18.3, MySQL 8.4.9, MariaDB 11.8.6, SQL Server 2022-CU24, Redis 8.6.2,
  Keycloak 26.6.1, Apache Kafka 4.2.0, Kafka UI 0.7.2, Redpanda 26.1.6,
  Redpanda Console 3.7.2, RabbitMQ 4.2.4-management, Mailpit 1.29.7.
- Compose template uses `{service}-__SVC__` keys and `__CONTAINER_NAME__` token to decouple
  generated service names and container names from the Docker image tag.

### Removed

- `identity-provider` template and all its scaffold files.

### Changed

- CLI entry point (`bin/cli.js`) refactored to support the dynamic template catalog;
  template-specific logic moved into each template's `config.js` module.

## [1.0.1] - 2026-02-21

### Fixed

- `start.sh` now validates that `compose.yml` does not contain unresolved `__KEYCLOAK_PORT__` placeholders before startup output is shown.
- `start.ps1` now validates unresolved `compose.yml` placeholders before parsing runtime values.
- Keycloak port parsing in both start scripts now accepts single/double-quoted port mappings in `compose.yml`.

## [1.0.0] - 2026-02-21

### Added

- Initial stable release of `@flowsydev/create-app` as a CLI package.
- `create-app` executable (`bin/cli.js`) with interactive scaffolding flow.
- `identity-provider` template scaffold with Keycloak + PostgreSQL container setup.
- Template helper scripts for start/stop on Bash and PowerShell.
- Keycloak realm examples and helper script to generate test users.

### Notes

- Package is intended to be published as public (`npm publish --access public`).
