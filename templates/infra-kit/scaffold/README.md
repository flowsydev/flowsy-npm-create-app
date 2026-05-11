# infra-kit

Local containerized infrastructure generated from the services selected during
project creation (PostgreSQL, MySQL, MariaDB, SQL Server, Redis, Keycloak, Apache Kafka,
Kafka UI, Redpanda, Redpanda Console, RabbitMQ, Mailpit). Works with `podman` or `docker`.

## Structure

The structure varies depending on the chosen services:

```text
<project>/
├── compose.yml
├── start.sh / start.ps1
├── stop.sh / stop.ps1
├── <service-name>/              (one folder per DB instance; e.g. postgres-18)
│   └── init/                   (SQL scripts executed when the volume is created)
│       └── 01-init-keycloak.sql   (only if Keycloak was included)
└── keycloak/                   (only if Keycloak was included)
    ├── scripts/
    │   └── keycloak-init.sh
    └── realms/
        ├── example.json
        └── README.md
```

> **Kafka**, **Kafka UI**, **Redpanda**, **Redpanda Console**, **RabbitMQ** and **Mailpit**
> do not generate additional folders; their configuration lives in `compose.yml`.

## Prerequisites

- `podman` with `podman compose` (or `podman-compose`)
- `docker` with `docker compose`

## Quick Start

### Linux / macOS

```bash
chmod +x start.sh stop.sh
./start.sh
```

### Windows (PowerShell)

```powershell
./start.ps1
```

### Explicitly select engine

```bash
./start.sh podman
./start.sh docker
```

```powershell
./start.ps1 -Engine podman
./start.ps1 -Engine docker
```

If no engine is specified, the default is `podman`.

## Services and Credentials

Check `compose.yml` to see the ports and credentials configured for each service.

## Customization

### PostgreSQL — initialization scripts

Place `*.sql` files in `<service-name>/init/` (e.g. `postgres-18/init/`). PostgreSQL executes
them in alphabetical order when the volume is first created.

> If the volume already exists, init scripts will not run again. Use `down -v` to
> force a clean reinitialization.

### Mailpit — local mail server for development

[Mailpit](https://mailpit.axllent.org/) captures emails sent by the application and
displays them in a web UI. It does not deliver real messages.

**Default ports:**

| Port | Protocol | Usage                        |
| ---- | -------- | ---------------------------- |
| 1025 | SMTP     | Receives emails from the app |
| 8025 | HTTP     | Web UI and REST API          |

**Accessing the UI:**

- From the host: `http://localhost:<ui-port>` (default: 8025)
- From other containers: `http://<service-name>:8025`

**SMTP configuration:**

- From the host: `smtp://localhost:<smtp-port>` (default: 1025)
- From other containers: `<service-name>:1025`

**Authentication:** the UI, API and SMTP are protected with the credentials configured
during project creation. Change them in the `environment` section of the service in
`compose.yml`.

> **Persistence:** emails are stored in `/data/mailpit.db` inside the container,
> backed by a Docker volume. Emails survive container restarts.

### Keycloak — add or modify realms

- Place `*.json` files in `keycloak/realms/`.
- Each file must contain the root attribute `"realm"`.

On each startup the script checks whether the realm already exists; if it doesn't it
imports it, if it does it skips it. To re-import a realm, delete it from Keycloak and
restart, or use the Keycloak API/CLI.

### Change users or passwords

Edit the `environment` section of the corresponding service in `compose.yml`.

## Stop and Clean Up

```bash
# Stop services
docker compose down
# or
podman compose down

# Stop and remove volumes (clean restart)
docker compose down -v
# or
podman compose down -v
```

## Troubleshooting

```bash
# Watch logs in real time
docker compose logs -f
# or
podman compose logs -f
```

If you modified SQL scripts after the first startup, run `down -v` so PostgreSQL
re-executes the scripts in `init/`.
