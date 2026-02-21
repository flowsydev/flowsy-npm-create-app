# identity-provider

Template to bring up a local identity provider using **Keycloak** and **PostgreSQL** with `Docker` or `Podman`.

## Pinned versions

- `postgres:__POSTGRES_VERSION__`
- `keycloak/keycloak:__KEYCLOAK_VERSION__`

## Structure

```text
identity-provider/
├── compose.yml
├── start.sh
├── start.ps1
├── stop.sh
├── stop.ps1
├── postgres/
│   └── init/
│       └── 01-init-keycloak.sql
└── keycloak/
    ├── scripts/
    │   ├── keycloak-init.sh
    │   └── generate_users.py
    └── realms/
        ├── example.json
        └── README.md
```

## Prerequisites

- `docker` with `docker compose`
- `podman` with `podman compose` (or `podman-compose`)

## Quick start

### Linux / macOS

```bash
chmod +x start.sh
./start.sh
```

### Windows (PowerShell)

```powershell
./start.ps1
```

### Explicit engine selection

```bash
./start.sh podman
./start.sh docker
```

```powershell
./start.ps1 -Engine podman
./start.ps1 -Engine docker
```

If no engine is specified, the default is `docker`.

## Default endpoints and credentials

- Keycloak: `http://localhost:__KEYCLOAK_PORT__`
  - Admin user: `__KEYCLOAK_ADMIN_USER__`
  - Admin password: `__KEYCLOAK_ADMIN_PASSWORD__`
- PostgreSQL:
  - Host: `localhost`
  - Port: `__POSTGRES_PORT__`
  - User: `postgres`
  - Password: `__POSTGRES_PASSWORD__`
  - Keycloak database:
    - Name: `__KEYCLOAK_DB_NAME__`
    - User: `__KEYCLOAK_DB_USER__`
    - Password: `__KEYCLOAK_DB_PASSWORD__`

## Customization

### 1) Add or modify realms

- Place `*.json` files in `keycloak/realms/`.
- Each file must contain a root attribute named `"realm"`.

### 1.1) Generate test users with AI agents

- The script `keycloak/scripts/generate_users.py` can be used by AI agents to generate test users for realm import files.
- It prints a JSON array of users that can be inserted into the `"users"` section of a realm file in `keycloak/realms/`.
- Example:

```bash
python keycloak/scripts/generate_users.py
```

### 2) Import behaviour

On each startup:

- Keycloak is started.
- Each JSON under `keycloak/realms/` is checked.
- If the realm **does not exist**, it is imported.
- If the realm **already exists**, it is skipped (not overwritten).

> Note: this template does not apply incremental updates (diffs) to existing realms. To apply changes, delete the realm from Keycloak and restart, or manage realms via API/CLI.

### 3) Change default users or passwords

Edit `compose.yml` under the `environment` section for each service.

## Stop and cleanup

Stop services:

```bash
docker compose -f compose.yml down
# or
podman compose -f compose.yml down
```

Stop and remove volumes (clean restart):

```bash
docker compose -f compose.yml down -v
# or
podman compose -f compose.yml down -v
```

## Troubleshooting

View logs:

```bash
docker compose -f compose.yml logs -f
# or
podman compose -f compose.yml logs -f
```

If you altered SQL scripts and a PostgreSQL volume already exists, remember to run `down -v` to force reinitialization.
