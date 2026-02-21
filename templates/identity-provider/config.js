import { resolve, basename } from 'node:path';
import fs from 'fs-extra';
import crypto from 'node:crypto';

function generateRandomPassword(length = 32) {
  return crypto.randomBytes(length).toString('base64').slice(0, length);
}

export function getPrompts() {
  return [
    {
      type: 'text',
      name: 'postgresVersion',
      message: 'PostgreSQL version:',
      initial: '18.2',
    },
    {
      type: 'number',
      name: 'postgresPort',
      message: 'PostgreSQL port:',
      initial: 5432,
      validate: (value) =>
        !value || (value >= 1024 && value <= 65535) ? true : 'Port must be between 1024 and 65535',
    },
    {
      type: 'password',
      name: 'postgresPassword',
      message: 'PostgreSQL password:',
      initial: 'p0stgr3s!',
    },
    {
      type: 'text',
      name: 'keycloakVersion',
      message: 'Keycloak version:',
      initial: '26.5',
    },
    {
      type: 'text',
      name: 'keycloakDbName',
      message: 'Keycloak database name:',
      initial: 'keycloak',
    },
    {
      type: 'text',
      name: 'keycloakDbUser',
      message: 'Keycloak database user:',
      initial: 'keycloak',
    },
    {
      type: 'password',
      name: 'keycloakDbPassword',
      message: 'Keycloak database password:',
      initial: 'k3ycl0ak!',
    },
    {
      type: 'number',
      name: 'keycloakPort',
      message: 'Keycloak port:',
      initial: 8080,
      validate: (value) =>
        !value || (value >= 1024 && value <= 65535) ? true : 'Port must be between 1024 and 65535',
    },
    {
      type: 'number',
      name: 'keycloakMetricsPort',
      message: 'Keycloak metrics port:',
      initial: 9000,
      validate: (value) =>
        !value || (value >= 1024 && value <= 65535) ? true : 'Port must be between 1024 and 65535',
    },
    {
      type: 'text',
      name: 'keycloakAdminUser',
      message: 'Keycloak admin user:',
      initial: 'admin',
    },
    {
      type: 'password',
      name: 'keycloakAdminPassword',
      message: 'Keycloak admin password:',
      initial: 'realmMast3r!',
    },
  ];
}

export async function configure(destPath, config) {
  const bootstrapUser = 'bootstrap-admin';
  const bootstrapPassword = generateRandomPassword(32);

  const fullConfig = {
    ...config,
    bootstrapUser,
    bootstrapPassword,
  };

  await replacePlaceholders(destPath, fullConfig);
}

async function replacePlaceholders(destPath, config) {
  const placeholders = {
    __POSTGRES_VERSION__: config.postgresVersion || '18.2',
    __POSTGRES_PORT__: config.postgresPort,
    __POSTGRES_PASSWORD__: config.postgresPassword,
    __PROJECT_NAME__: basename(destPath),
    __KEYCLOAK_VERSION__: config.keycloakVersion || '26.5',
    __KEYCLOAK_DB_NAME__: config.keycloakDbName,
    __KEYCLOAK_DB_USER__: config.keycloakDbUser,
    __KEYCLOAK_DB_PASSWORD__: config.keycloakDbPassword,
    __KEYCLOAK_PORT__: config.keycloakPort,
    __KEYCLOAK_METRICS_PORT__: config.keycloakMetricsPort,
    __KEYCLOAK_BOOTSTRAP_ADMIN_USER__: config.bootstrapUser,
    __KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD__: config.bootstrapPassword,
    __KEYCLOAK_ADMIN_USER__: config.keycloakAdminUser,
    __KEYCLOAK_ADMIN_PASSWORD__: config.keycloakAdminPassword,
  };

  const filesToProcess = ['compose.yml', 'README.md', 'postgres/init/01-init-keycloak.sql'];

  for (const file of filesToProcess) {
    const filePath = resolve(destPath, file);
    if (!fs.existsSync(filePath)) continue;

    let content = await fs.readFile(filePath, 'utf-8');

    for (const [placeholder, value] of Object.entries(placeholders)) {
      content = content.replace(new RegExp(placeholder, 'g'), String(value));
    }

    await fs.writeFile(filePath, content, 'utf-8');
  }
}
