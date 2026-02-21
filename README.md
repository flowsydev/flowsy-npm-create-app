# Flowsy Application Starter Tool

## Prerequisites

This tool requires Node.js, which can be installed manually from <https://nodejs.org/> or using Node Version Manager (recommended):

- Mac/Linux: <https://github.com/nvm-sh/nvm>
- Windows: <https://github.com/coreybutler/nvm-windows>

```shell
nvm install 22
nvm use 22

# Set as default version (optional and only for Mac/Linux)
nvm alias default 22
```

**Important:** Do not upgrade the Node Package Manager (NPM) version included with the Node.js version installed using NVM.

## Usage

```shell
npx @flowsydev/create-app $APP_NAME
# If application name is not provided, the tool will ask for it later
```

### Prompt examples by template

Currently available templates:

- `identity-provider`

Example prompts for `identity-provider`:

```text
? Application type:  Identity Provider (Keycloak + PostgreSQL in Containers)
? Project name:  my-identity-provider
? Destination folder (relative to current directory):  .
? PostgreSQL version:  18.2
? PostgreSQL port:  5432
? PostgreSQL password:  p0stgr3s!
? Keycloak version:  26.5
? Keycloak database name:  keycloak
? Keycloak database user:  keycloak
? Keycloak database password:  k3ycl0ak!
? Keycloak port:  8080
? Keycloak metrics port:  9000
? Keycloak admin user:  admin
? Keycloak admin password:  realmMast3r!
? Initialize a Git repository?  No
? The folder already exists. Overwrite?  No  # only shown if target folder exists
```
