# Changelog

All notable changes to this project will be documented in this file.

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
