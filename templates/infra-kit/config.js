import { resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import crypto from 'node:crypto';
import prompts from 'prompts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// -- Service constants --------------------------------------------------------
// Each dictionary is keyed by the canonical service identifier.

const SERVICE_LABELS = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mssql: 'Microsoft SQL Server',
  redis: 'Redis',
  keycloak: 'Keycloak',
  kafka: 'Apache Kafka (KRaft)',
  'kafka-ui': 'Kafka UI',
  redpanda: 'Redpanda',
  'redpanda-console': 'Redpanda Console',
  rabbitmq: 'RabbitMQ',
  mailpit: 'Mailpit',
};

const SERVICE_DEFAULT_IMAGES = {
  postgres: 'postgres',
  mysql: 'mysql',
  mariadb: 'mariadb',
  mssql: 'mcr.microsoft.com/mssql/server',
  redis: 'redis',
  keycloak: 'keycloak/keycloak',
  kafka: 'apache/kafka',
  'kafka-ui': 'provectuslabs/kafka-ui',
  redpanda: 'redpandadata/redpanda',
  'redpanda-console': 'redpandadata/console',
  rabbitmq: 'rabbitmq',
  mailpit: 'axllent/mailpit',
};

const SERVICE_DEFAULT_VERSIONS = {
  postgres: '18.3',
  mysql: '8.4.9',
  mariadb: '11.8.6',
  mssql: '2022-CU24-ubuntu-22.04',
  redis: '8.6.2',
  keycloak: '26.6.1',
  kafka: '4.2.0',
  'kafka-ui': 'v0.7.2',
  redpanda: 'v26.1.6',
  'redpanda-console': 'v3.7.2',
  rabbitmq: '4.2.4-management',
  mailpit: 'v1.29.7',
};

/** Internal container ports exposed to the host. */
const SERVICE_INTERNAL_PORTS = {
  postgres: [5432],
  mysql: [3306],
  mariadb: [3306],
  mssql: [1433],
  redis: [6379],
  keycloak: [8080, 9000],
  kafka: [9092],
  'kafka-ui': [8080],
  redpanda: [9092, 8081, 8082, 9644],
  'redpanda-console': [8080],
  rabbitmq: [5672, 15672],
  mailpit: [1025, 8025],
};

/** Default internal->external port mapping offered to the user. */
const SERVICE_DEFAULT_EXTERNAL_PORTS = {
  postgres: { 5432: 5432 },
  mysql: { 3306: 3306 },
  mariadb: { 3306: 3307 },
  mssql: { 1433: 1433 },
  redis: { 6379: 6379 },
  keycloak: { 8080: 8888, 9000: 9999 },
  kafka: { 9092: 9092 },
  'kafka-ui': { 8080: 8080 },
  redpanda: { 9092: 19092, 8081: 18081, 8082: 18082, 9644: 19644 },
  'redpanda-console': { 8080: 8080 },
  rabbitmq: { 5672: 5672, 15672: 15672 },
  mailpit: { 1025: 1025, 8025: 8025 },
};

/** Canonical configuration order. */
const SERVICE_ORDER = [
  'postgres',
  'mysql',
  'mariadb',
  'mssql',
  'redis',
  'keycloak',
  'kafka',
  'kafka-ui',
  'redpanda',
  'redpanda-console',
  'rabbitmq',
  'mailpit',
];

/**
 * Service dependencies.
 * - Normal array: requires AT LEAST ONE of the listed services (OR).
 * - Used for auto-adding dependencies and validating removals.
 */
const SERVICE_DEPENDENCIES = {
  keycloak: ['postgres', 'mysql', 'mariadb', 'mssql'],
  'kafka-ui': ['kafka'],
  'redpanda-console': ['redpanda'],
};

/** Mapping of databases supported by Keycloak to the KC_DB value and internal port. */
const KEYCLOAK_DB_VENDORS = {
  postgres: { kcDb: 'postgres', port: 5432 },
  mysql: { kcDb: 'mysql', port: 3306 },
  mariadb: { kcDb: 'mariadb', port: 3306 },
  mssql: { kcDb: 'mssql', port: 1433 },
};

// -- Utilities ----------------------------------------------------------------

/** Extracts the major version number from a Docker image tag (strips leading 'v'). */
function extractMajorVersion(tag) {
  const normalized = tag.startsWith('v') ? tag.slice(1) : tag;
  const match = normalized.match(/^(\d+)/);
  return match ? match[1] : normalized;
}

function getDefaultServiceName(service, tag) {
  return `${service}-${extractMajorVersion(tag)}`;
}

function validateServiceName(service, tag, value) {
  const name = value.trim();
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    return 'Use lowercase letters, numbers, hyphens or underscores';
  }
  if (name === service) {
    return `Use a versioned name such as '${getDefaultServiceName(service, tag)}'`;
  }
  return true;
}

function generateRandomPassword(length = 32) {
  return crypto.randomBytes(length).toString('base64').slice(0, length);
}

/** Shared handler: aborts when the user cancels a prompt. */
const onCancel = () => {
  throw new Error('Operation cancelled');
};

// -- Parsing existing compose.yml ---------------------------------------------

/**
 * Extracts concrete service names (e.g. "postgres-18", "kafka-3.9.2")
 * from a compose.yml. Looks for lines with exactly 2 spaces of indentation.
 */
function extractServiceNames(composeContent) {
  const servicesIdx = composeContent.search(/^services:\s*$/m);
  if (servicesIdx < 0) return [];
  const afterServices = composeContent.slice(servicesIdx).replace(/^services:\s*\n/, '');
  const endMatch = afterServices.match(/^[a-zA-Z]/m);
  const block = endMatch ? afterServices.slice(0, endMatch.index) : afterServices;
  const names = [];
  const regex = /^ {2}(\S+):$/gm;
  let match;
  while ((match = regex.exec(block)) !== null) {
    names.push(match[1]);
  }
  return names;
}

/**
 * Maps a concrete service name to its canonical type.
 * Returns null if it does not match any known type.
 */
function resolveServiceType(serviceName) {
  for (const id of SERVICE_ORDER) {
    if (serviceName === id || serviceName.startsWith(`${id}-`)) {
      return id;
    }
  }
  return null;
}

/**
 * Parses a compose.yml and returns structured information for each instance.
 *
 * @returns {{ serviceTypes: Set<string>, instances: Map<string, Array<{ serviceName, tag, image, ports }>> }}
 */
export async function detectExistingServices(destPath) {
  return parseExistingCompose(destPath);
}

export async function parseExistingCompose(destPath) {
  const composePath = resolve(destPath, 'compose.yml');
  if (!fs.existsSync(composePath)) {
    return { serviceTypes: new Set(), instances: new Map() };
  }

  const content = await fs.readFile(composePath, 'utf-8');
  const lines = content.split('\n');

  // Locate the services: section
  let servicesStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === 'services:') {
      servicesStart = i;
      break;
    }
  }
  if (servicesStart < 0) return { serviceTypes: new Set(), instances: new Map() };

  // Extract service blocks (indent 2)
  const blocks = [];
  let current = null;

  for (let i = servicesStart + 1; i < lines.length; i++) {
    const line = lines[i];
    // Non-indented top-level line -> end of services
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#')) break;

    const nameMatch = line.match(/^ {2}(\S+):$/);
    if (nameMatch) {
      if (current) current.endLine = i - 1;
      current = { name: nameMatch[1], startLine: i, endLine: i, lines: [] };
      blocks.push(current);
    } else if (current) {
      current.lines.push(line);
      current.endLine = i;
    }
  }

  // Parse each block to extract image and ports
  const serviceTypes = new Set();
  const instances = new Map();

  for (const block of blocks) {
    const type = resolveServiceType(block.name);
    if (!type) continue;

    const tag = block.name.startsWith(`${type}-`) ? block.name.slice(type.length + 1) : '';

    let image = '';
    const ports = {};
    let inPortsSection = false;

    for (const line of block.lines) {
      const trimmed = line.trim();

      const imgMatch = trimmed.match(/^image:\s*(.+)$/);
      if (imgMatch) {
        image = imgMatch[1];
        continue;
      }

      if (trimmed === 'ports:') {
        inPortsSection = true;
        continue;
      }
      if (inPortsSection) {
        const portMatch = trimmed.match(/^-\s*"?(\d+):(\d+)"?$/);
        if (portMatch) {
          ports[parseInt(portMatch[2], 10)] = parseInt(portMatch[1], 10);
        } else if (!trimmed.startsWith('-') && !trimmed.startsWith('#')) {
          inPortsSection = false;
        }
      }
    }

    serviceTypes.add(type);
    if (!instances.has(type)) instances.set(type, []);
    instances.get(type).push({ serviceName: block.name, tag, image, ports });
  }

  return { serviceTypes, instances };
}

// -- Template public API ------------------------------------------------------

/**
 * Returns the initial template prompts.
 *
 * - New project: multiselect of services.
 * - Existing project: multiselect of actions (add, edit, remove).
 */
export function getPrompts({ existingServices = new Set() } = {}) {
  if (existingServices.size > 0) {
    return [
      {
        type: 'multiselect',
        name: 'actions',
        message: 'What would you like to do?',
        choices: [
          { title: 'Add new services', value: 'add-new' },
          { title: 'Add instances to existing services', value: 'add-tags' },
          { title: 'Edit existing instances', value: 'edit' },
          { title: 'Remove existing services', value: 'remove' },
        ],
        min: 1,
        instructions: false,
      },
    ];
  }

  return [
    {
      type: 'multiselect',
      name: 'services',
      message: 'Which services would you like to include?',
      choices: SERVICE_ORDER.map((id) => ({
        title: SERVICE_LABELS[id],
        value: id,
        selected: id === 'postgres',
      })),
      min: 1,
      instructions: false,
    },
  ];
}

// -- collectConfig: new project -----------------------------------------------

/**
 * Collects all interactive template configuration via prompts.
 *
 * @param {object} initialConfig - Result from the initial prompt.
 * @param {{ existingServices?: Set<string>, existingDetails?: object, destPath?: string }} [options]
 */
export async function collectConfig(
  initialConfig,
  { existingServices = new Set(), existingDetails = null, destPath } = {}
) {
  // Update mode: branch by actions
  if (initialConfig.actions) {
    return collectUpdateConfig(initialConfig.actions, {
      existingServices,
      existingDetails,
      destPath,
    });
  }

  // Creation mode: normal flow
  return collectNewConfig(initialConfig.services);
}

/** Configuration flow for a new project. */
async function collectNewConfig(selectedServices) {
  const services = [...selectedServices];

  // Automatic dependencies
  resolveAutoDependencies(services, new Set());
  services.sort((a, b) => SERVICE_ORDER.indexOf(a) - SERVICE_ORDER.indexOf(b));

  const serviceConfigs = {};
  for (const service of services) {
    serviceConfigs[service] = await promptServiceConfig(service, { serviceConfigs });
  }

  return { services, serviceConfigs, removals: [], edits: {}, additions: {} };
}

/** Resolves automatic dependencies for a list of services. */
function resolveAutoDependencies(services, existingServices) {
  for (const [dependent, deps] of Object.entries(SERVICE_DEPENDENCIES)) {
    if (!services.includes(dependent)) continue;
    // Check if at least one dependency is satisfied
    const hasDep = deps.some((d) => services.includes(d) || existingServices.has(d));
    if (!hasDep) {
      const defaultDep = deps[0];
      console.log(
        `\n${SERVICE_LABELS[dependent]} requires ${SERVICE_LABELS[defaultDep]}. It will be added automatically.\n`
      );
      const depIdx = services.indexOf(dependent);
      services.splice(depIdx, 0, defaultDep);
    }
  }
}

/** Prompts for all service configuration: image, tags, ports, credentials. */
async function promptServiceConfig(service, { serviceConfigs = {}, destPath } = {}) {
  console.log(`\n-- ${SERVICE_LABELS[service]} --`);

  // Image
  const { imageName } = await prompts(
    {
      type: 'text',
      name: 'imageName',
      message: `${SERVICE_LABELS[service]} image name (without tag):`,
      initial: SERVICE_DEFAULT_IMAGES[service],
      validate: (v) => (v.trim() ? true : 'You must specify an image name'),
    },
    { onCancel }
  );

  const config = { imageName, tags: [], instances: [] };

  // Tags (versions)
  const { tagsInput } = await prompts(
    {
      type: 'text',
      name: 'tagsInput',
      message: `${SERVICE_LABELS[service]} tags (comma-separated):`,
      initial: SERVICE_DEFAULT_VERSIONS[service],
      validate: (v) => (v.trim() !== '' ? true : 'Specify at least one version'),
    },
    { onCancel }
  );

  const tags = tagsInput
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  config.tags = tags;

  // Ports and service name per instance (tag)
  for (const tag of tags) {
    const ports = await promptPorts(service, tag);
    const defaultServiceName = getDefaultServiceName(service, tag);
    const { serviceName } = await prompts(
      {
        type: 'text',
        name: 'serviceName',
        message: `  Service name for ${service}:${tag} (in compose.yml):`,
        initial: defaultServiceName,
        validate: (v) => validateServiceName(service, tag, v),
      },
      { onCancel }
    );
    config.instances.push({ tag, ports, serviceName });
  }

  // Service-specific credentials and config
  await promptServiceSpecificConfig(service, config, serviceConfigs, destPath);

  return config;
}

/** Prompts for external ports for a service:tag. */
async function promptPorts(service, tag) {
  const portPrompts = SERVICE_INTERNAL_PORTS[service].map((internalPort) => ({
    type: 'number',
    name: `port_${internalPort}`,
    message: `  External port for internal port ${internalPort} of ${service}:${tag}:`,
    initial: SERVICE_DEFAULT_EXTERNAL_PORTS[service][internalPort],
    validate: (v) =>
      !v || (v >= 1024 && v <= 65535) ? true : 'Port must be between 1024 and 65535',
  }));

  const portConfig = await prompts(portPrompts, { onCancel });

  const ports = {};
  for (const internalPort of SERVICE_INTERNAL_PORTS[service]) {
    ports[internalPort] = portConfig[`port_${internalPort}`];
  }
  return ports;
}

/** Prompts for service-specific configuration (credentials, dependencies). */
async function promptServiceSpecificConfig(service, config, serviceConfigs, destPath) {
  if (service === 'postgres') {
    const { password } = await prompts(
      {
        type: 'password',
        name: 'password',
        message: 'PostgreSQL password (superuser):',
        initial: 'p0stgr3s!',
      },
      { onCancel }
    );
    config.password = password;
  }

  if (service === 'mysql') {
    const creds = await prompts(
      [
        {
          type: 'password',
          name: 'rootPassword',
          message: 'MySQL root password:',
          initial: 'mYsql!r00t',
        },
        {
          type: 'text',
          name: 'database',
          message: 'MySQL initial database:',
          initial: 'app',
        },
        { type: 'text', name: 'user', message: 'MySQL user:', initial: 'app' },
        {
          type: 'password',
          name: 'password',
          message: 'MySQL user password:',
          initial: 'mYsql!us3r',
        },
      ],
      { onCancel }
    );
    Object.assign(config, creds);
  }

  if (service === 'mariadb') {
    const creds = await prompts(
      [
        {
          type: 'password',
          name: 'rootPassword',
          message: 'MariaDB root password:',
          initial: 'm4r1aDB!',
        },
        {
          type: 'text',
          name: 'database',
          message: 'MariaDB initial database:',
          initial: 'app',
        },
        { type: 'text', name: 'user', message: 'MariaDB user:', initial: 'app' },
        {
          type: 'password',
          name: 'password',
          message: 'MariaDB user password:',
          initial: 'm4r1a!us3r',
        },
      ],
      { onCancel }
    );
    Object.assign(config, creds);
  }

  if (service === 'mssql') {
    const { saPassword } = await prompts(
      {
        type: 'password',
        name: 'saPassword',
        message: 'SQL Server SA password:',
        initial: 'SqlS3rv3r!',
        validate: (v) =>
          /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d]).{8,}/.test(v)
            ? true
            : 'Must have 8+ chars with uppercase, lowercase, numbers and symbols',
      },
      { onCancel }
    );
    config.saPassword = saPassword;
  }

  if (service === 'rabbitmq') {
    const creds = await prompts(
      [
        { type: 'text', name: 'user', message: 'RabbitMQ user:', initial: 'admin' },
        {
          type: 'password',
          name: 'password',
          message: 'RabbitMQ password:',
          initial: 'r4bb1tMQ!',
        },
      ],
      { onCancel }
    );
    Object.assign(config, creds);
  }

  if (service === 'mailpit') {
    const creds = await prompts(
      [
        { type: 'text', name: 'uiUser', message: 'Mailpit UI & API user:', initial: 'admin' },
        {
          type: 'password',
          name: 'uiPassword',
          message: 'Mailpit UI & API password:',
          initial: 'm4ilp1t!',
        },
        {
          type: 'text',
          name: 'sendUser',
          message: 'Mailpit send API user:',
          initial: 'admin',
        },
        {
          type: 'password',
          name: 'sendPassword',
          message: 'Mailpit send API password:',
          initial: 'm4ilp1t!',
        },
        { type: 'text', name: 'smtpUser', message: 'Mailpit SMTP user:', initial: 'admin' },
        {
          type: 'password',
          name: 'smtpPassword',
          message: 'Mailpit SMTP password:',
          initial: 'm4ilp1t!',
        },
      ],
      { onCancel }
    );
    config.uiAuth = `${creds.uiUser}:${creds.uiPassword}`;
    config.sendApiAuth = `${creds.sendUser}:${creds.sendPassword}`;
    config.smtpAuth = `${creds.smtpUser}:${creds.smtpPassword}`;
  }

  // Dependency: kafka-ui -> kafka
  if (service === 'kafka-ui') {
    const kafkaServiceName = await promptDependencyInstance('kafka', serviceConfigs, destPath);
    config.kafkaServiceName = kafkaServiceName;
  }

  // Dependency: redpanda-console -> redpanda
  if (service === 'redpanda-console') {
    const redpandaServiceName = await promptDependencyInstance(
      'redpanda',
      serviceConfigs,
      destPath
    );
    config.redpandaServiceName = redpandaServiceName;
  }

  // Keycloak: DB engine selection + instance + credentials
  if (service === 'keycloak') {
    await promptKeycloakConfig(config, serviceConfigs, destPath);
  }
}

/** Prompts for selecting a dependency instance (new or existing). Returns the service name. */
async function promptDependencyInstance(depType, serviceConfigs, destPath) {
  const newServiceNames = (serviceConfigs[depType]?.instances ?? []).map(
    ({ serviceName }) => serviceName
  );
  const existingServiceNames = destPath ? await getExistingServiceNames(destPath, depType) : [];
  const allServiceNames = [...existingServiceNames, ...newServiceNames];

  const fallback = `${depType}-${extractMajorVersion(SERVICE_DEFAULT_VERSIONS[depType])}`;
  if (allServiceNames.length === 0) return fallback;

  if (allServiceNames.length === 1) {
    console.log(`  Will connect to ${allServiceNames[0]}`);
    return allServiceNames[0];
  }

  const { selected } = await prompts(
    {
      type: 'select',
      name: 'selected',
      message: `Which ${SERVICE_LABELS[depType]} instance will it connect to?`,
      choices: allServiceNames.map((name) => ({ title: name, value: name })),
    },
    { onCancel }
  );
  return selected;
}

/** Prompts for Keycloak configuration (DB engine, instance, credentials). */
async function promptKeycloakConfig(config, serviceConfigs, destPath) {
  // Determine available DB engines (new + existing)
  const availableVendors = [];
  for (const vendor of Object.keys(KEYCLOAK_DB_VENDORS)) {
    const hasNew = serviceConfigs[vendor]?.instances?.length > 0;
    const hasExisting = destPath
      ? (await getExistingServiceNames(destPath, vendor)).length > 0
      : false;
    if (hasNew || hasExisting) {
      availableVendors.push(vendor);
    }
  }

  if (availableVendors.length === 0) {
    // Fallback: should not happen if automatic dependencies work
    availableVendors.push('postgres');
  }

  // Select DB engine
  let dbVendor;
  if (availableVendors.length > 1) {
    const { vendor } = await prompts(
      {
        type: 'select',
        name: 'vendor',
        message: 'Which database engine will Keycloak use?',
        choices: availableVendors.map((v) => ({
          title: SERVICE_LABELS[v],
          value: v,
        })),
      },
      { onCancel }
    );
    dbVendor = vendor;
  } else {
    dbVendor = availableVendors[0];
    console.log(`  Database: ${SERVICE_LABELS[dbVendor]}`);
  }

  // Select engine instance
  const dbServiceName = await promptDependencyInstance(dbVendor, serviceConfigs, destPath);

  // Keycloak credentials
  const extra = await prompts(
    [
      {
        type: 'text',
        name: 'dbName',
        message: 'Keycloak database name:',
        initial: 'keycloak',
      },
      {
        type: 'text',
        name: 'dbUser',
        message: 'Keycloak database user:',
        initial: 'keycloak',
      },
      {
        type: 'password',
        name: 'dbPassword',
        message: 'Keycloak database password:',
        initial: 'k3ycl0ak!',
      },
      {
        type: 'text',
        name: 'adminUser',
        message: 'Keycloak admin user:',
        initial: 'admin',
      },
      {
        type: 'password',
        name: 'adminPassword',
        message: 'Keycloak admin password:',
        initial: 'realmMast3r!',
      },
    ],
    { onCancel }
  );

  Object.assign(config, extra, {
    dbVendor,
    dbServiceName,
    bootstrapUser: 'bootstrap-admin',
    bootstrapPassword: generateRandomPassword(32),
  });
}

/** Returns the full service names of existing instances for a service type in compose.yml. */
async function getExistingServiceNames(destPath, serviceType) {
  const composePath = resolve(destPath, 'compose.yml');
  if (!fs.existsSync(composePath)) return [];

  const content = await fs.readFile(composePath, 'utf-8');
  const prefix = `${serviceType}-`;
  return extractServiceNames(content).filter((name) => name.startsWith(prefix));
}

// -- collectConfig: update mode -----------------------------------------------

async function collectUpdateConfig(actions, { existingServices, existingDetails, destPath }) {
  const result = {
    services: [],
    serviceConfigs: {},
    additions: {},
    edits: {},
    removals: [],
  };

  if (actions.includes('add-new')) {
    await collectAddNewServices(result, existingServices, destPath);
  }

  if (actions.includes('add-tags')) {
    await collectAddTags(result, existingDetails);
  }

  if (actions.includes('edit')) {
    await collectEditInstances(result, existingDetails);
  }

  if (actions.includes('remove')) {
    await collectRemoveInstances(result, existingDetails, existingServices);
  }

  return result;
}

/** Action: add new service types. */
async function collectAddNewServices(result, existingServices, destPath) {
  const availableTypes = SERVICE_ORDER.filter((id) => !existingServices.has(id));
  if (availableTypes.length === 0) {
    console.log('\nAll service types are already configured.');
    return;
  }

  const { newServices } = await prompts(
    {
      type: 'multiselect',
      name: 'newServices',
      message: 'Which new services would you like to add?',
      choices: availableTypes.map((id) => ({
        title: SERVICE_LABELS[id],
        value: id,
      })),
      min: 1,
      instructions: false,
    },
    { onCancel }
  );

  const services = [...newServices];
  resolveAutoDependencies(services, existingServices);
  services.sort((a, b) => SERVICE_ORDER.indexOf(a) - SERVICE_ORDER.indexOf(b));

  for (const service of services) {
    result.serviceConfigs[service] = await promptServiceConfig(service, {
      serviceConfigs: result.serviceConfigs,
      destPath,
    });
  }
  result.services = services;
}

/** Action: add instances (tags) to existing services. */
async function collectAddTags(result, existingDetails) {
  if (!existingDetails?.instances?.size) {
    console.log('\nNo existing services to add instances to.');
    return;
  }

  const typeChoices = [];
  for (const [type, instances] of existingDetails.instances) {
    const currentNames = instances.map((i) => i.serviceName).join(', ');
    typeChoices.push({
      title: `${SERVICE_LABELS[type]} (current: ${currentNames})`,
      value: type,
    });
  }

  const { selectedTypes } = await prompts(
    {
      type: 'multiselect',
      name: 'selectedTypes',
      message: 'Which services would you like to add instances to?',
      choices: typeChoices,
      min: 1,
      instructions: false,
    },
    { onCancel }
  );

  for (const type of selectedTypes) {
    const existing = existingDetails.instances.get(type);
    const currentImage = existing[0]?.image?.split(':')[0] ?? SERVICE_DEFAULT_IMAGES[type];
    const currentServiceNames = existing.map((i) => i.serviceName);

    console.log(`\n-- ${SERVICE_LABELS[type]} (existing: ${currentServiceNames.join(', ')}) --`);

    const { tagsInput } = await prompts(
      {
        type: 'text',
        name: 'tagsInput',
        message: 'New image tags to add (comma-separated):',
        validate: (v) => {
          const newTags = v
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
          return newTags.length > 0 ? true : 'Specify at least one tag';
        },
      },
      { onCancel }
    );

    const newTags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const instances = [];

    for (const tag of newTags) {
      const ports = await promptPorts(type, tag);
      const defaultServiceName = getDefaultServiceName(type, tag);
      const { serviceName } = await prompts(
        {
          type: 'text',
          name: 'serviceName',
          message: `  Service name for ${type}:${tag} (in compose.yml):`,
          initial: defaultServiceName,
          validate: (v) => {
            const nameValidation = validateServiceName(type, tag, v);
            if (nameValidation !== true) return nameValidation;
            if (currentServiceNames.includes(v.trim())) {
              return `Service name '${v.trim()}' already exists`;
            }
            return true;
          },
        },
        { onCancel }
      );
      instances.push({ tag, ports, serviceName });
    }

    result.additions[type] = { imageName: currentImage, instances };
  }
}

/** Action: edit existing instances. */
async function collectEditInstances(result, existingDetails) {
  if (!existingDetails?.instances?.size) {
    console.log('\nNo existing instances to edit.');
    return;
  }

  // Build flat list of all instances
  const instanceChoices = [];
  for (const [type, instances] of existingDetails.instances) {
    for (const inst of instances) {
      const portsStr = Object.entries(inst.ports)
        .map(([int, ext]) => `${ext}->${int}`)
        .join(', ');
      instanceChoices.push({
        title: `${inst.image}  [${portsStr}]`,
        value: { type, ...inst },
      });
    }
  }

  const { toEdit } = await prompts(
    {
      type: 'multiselect',
      name: 'toEdit',
      message: 'Which instances would you like to edit?',
      choices: instanceChoices,
      min: 1,
      instructions: false,
    },
    { onCancel }
  );

  for (const inst of toEdit) {
    console.log(`\n-- Editing ${inst.serviceName} --`);

    const currentImage = inst.image.split(':')[0];
    const currentImageTag = inst.image.split(':')[1] ?? inst.tag;

    const { imageName } = await prompts(
      {
        type: 'text',
        name: 'imageName',
        message: `Image (current: ${currentImage}):`,
        initial: currentImage,
      },
      { onCancel }
    );

    const { imageTag } = await prompts(
      {
        type: 'text',
        name: 'imageTag',
        message: `Image tag/version (current: ${currentImageTag}):`,
        initial: currentImageTag,
        validate: (v) => (v.trim() ? true : 'Specify an image tag'),
      },
      { onCancel }
    );

    const defaultServiceName = getDefaultServiceName(inst.type, imageTag);
    const { newServiceName } = await prompts(
      {
        type: 'text',
        name: 'newServiceName',
        message: `Service name in compose.yml (current: ${inst.serviceName}):`,
        initial: inst.serviceName !== defaultServiceName ? inst.serviceName : defaultServiceName,
        validate: (v) => validateServiceName(inst.type, imageTag, v),
      },
      { onCancel }
    );

    const ports = {};
    for (const [internalStr, currentExternal] of Object.entries(inst.ports)) {
      const internal = parseInt(internalStr, 10);
      const { port } = await prompts(
        {
          type: 'number',
          name: 'port',
          message: `  External port for ${internal} (current: ${currentExternal}):`,
          initial: currentExternal,
          validate: (v) =>
            !v || (v >= 1024 && v <= 65535) ? true : 'Port must be between 1024 and 65535',
        },
        { onCancel }
      );
      ports[internal] = port;
    }

    result.edits[inst.serviceName] = {
      type: inst.type,
      oldName: inst.serviceName,
      imageName,
      imageTag,
      serviceName: newServiceName,
      ports,
    };
  }
}

/** Action: remove existing instances. */
async function collectRemoveInstances(result, existingDetails, existingServices) {
  if (!existingDetails?.instances?.size) {
    console.log('\nNo existing instances to remove.');
    return;
  }

  const instanceChoices = [];
  for (const [type, instances] of existingDetails.instances) {
    for (const inst of instances) {
      instanceChoices.push({
        title: `${inst.serviceName}  (${inst.image})`,
        value: { type, ...inst },
      });
    }
  }

  const { toRemove } = await prompts(
    {
      type: 'multiselect',
      name: 'toRemove',
      message: 'Which instances would you like to remove?',
      choices: instanceChoices,
      min: 1,
      instructions: false,
    },
    { onCancel }
  );

  // Validate dependencies
  const removalNames = new Set(toRemove.map((i) => i.serviceName));
  const warnings = [];

  for (const removing of toRemove) {
    // Check if any dependent service would lose all its dependencies
    for (const [dependent, deps] of Object.entries(SERVICE_DEPENDENCIES)) {
      if (!existingServices.has(dependent)) continue;
      if (!deps.includes(removing.type)) continue;

      // Count how many instances of the depended type would remain
      const allOfType = existingDetails.instances.get(removing.type) ?? [];
      const remaining = allOfType.filter((i) => !removalNames.has(i.serviceName));
      if (remaining.length === 0) {
        warnings.push(
          `${SERVICE_LABELS[dependent]} depends on ${SERVICE_LABELS[removing.type]}. ` +
            `Removing all ${SERVICE_LABELS[removing.type]} instances will leave ${SERVICE_LABELS[dependent]} without a database.`
        );
      }
    }
  }

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  - ${w}`);

    const { confirmRemove } = await prompts(
      {
        type: 'confirm',
        name: 'confirmRemove',
        message: 'Continue with removal?',
        initial: false,
      },
      { onCancel }
    );
    if (!confirmRemove) return;
  }

  result.removals = toRemove.map((i) => i.serviceName);
}

// -- configure: apply configuration to destination ----------------------------

/**
 * Applies the configuration collected by collectConfig() to the destination directory.
 * Only performs file I/O; does not launch interactive prompts.
 */
export async function configure(destPath, enrichedConfig) {
  const {
    services = [],
    serviceConfigs = {},
    removals = [],
    edits = {},
    additions = {},
  } = enrichedConfig;
  const projectName = basename(destPath);
  const composePath = resolve(destPath, 'compose.yml');
  const isUpdate = fs.existsSync(composePath);

  // 1. Remove services
  if (removals.length > 0) {
    await removeFromCompose(composePath, removals);
    await cleanRemovedServiceDirs(destPath, removals);
  }

  // 2. Edit existing instances
  if (Object.keys(edits).length > 0) {
    await applyEdits(destPath, edits, projectName);
  }

  // 3. Add instances (tags) to existing services
  if (Object.keys(additions).length > 0) {
    await applyAdditions(destPath, additions, projectName);
  }

  // 4. Add new service types
  if (services.length > 0) {
    // In update mode, copy partial scaffold if needed
    if (isUpdate && services.includes('keycloak')) {
      const scaffoldKeycloak = resolve(__dirname, 'scaffold', 'keycloak');
      const destKeycloak = resolve(destPath, 'keycloak');
      if (fs.existsSync(scaffoldKeycloak) && !fs.existsSync(destKeycloak)) {
        await fs.copy(scaffoldKeycloak, destKeycloak);
      }
    }

    await generateCompose(destPath, services, serviceConfigs, projectName);
    await createDbInitDirs(destPath, services, serviceConfigs);
    await copyKeycloakInitSql(destPath, services, serviceConfigs);

    if (!isUpdate) {
      await cleanUnusedFolders(destPath, services);
    }
  }
}

// -- Template block extraction ------------------------------------------------

function extractLines(templateContent, marker) {
  const begin = `# [${marker}]`;
  const end = `# [/${marker}]`;
  const lines = templateContent.split('\n');
  const result = [];
  let inside = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === begin) {
      inside = true;
      continue;
    }
    if (trimmed === end) {
      inside = false;
      continue;
    }
    if (inside) result.push(line);
  }

  return result;
}

// -- compose.yml generation ---------------------------------------------------

async function generateCompose(destPath, services, serviceConfigs, projectName) {
  const templatePath = resolve(__dirname, 'compose.template.yml');
  const templateContent = await fs.readFile(templatePath, 'utf-8');

  const composePath = resolve(destPath, 'compose.yml');
  const isUpdate = fs.existsSync(composePath);

  const volumeLines = [];
  const serviceLines = [];

  for (const service of services) {
    const cfg = serviceConfigs[service];
    for (const { tag, ports, serviceName } of cfg.instances) {
      const volBlock = extractLines(templateContent, `${service}-volumes`);
      if (volBlock.length > 0) {
        volumeLines.push(
          substituteVars(volBlock.join('\n'), {
            service,
            tag,
            ports,
            projectName,
            serviceConfigs,
            serviceName,
          })
        );
      }

      const svcBlock = extractLines(templateContent, service);
      if (svcBlock.length > 0) {
        serviceLines.push(
          substituteVars(svcBlock.join('\n'), {
            service,
            tag,
            ports,
            projectName,
            serviceConfigs,
            serviceName,
          })
        );
      }
    }
  }

  let compose;
  if (isUpdate) {
    const existing = await fs.readFile(composePath, 'utf-8');
    compose = mergeIntoExistingCompose(existing, volumeLines, serviceLines);
  } else {
    compose = '';
    if (volumeLines.length > 0) {
      compose += 'volumes:\n' + volumeLines.join('\n') + '\n\n';
    }
    compose += 'services:\n' + serviceLines.join('\n') + '\n';
  }

  await fs.writeFile(composePath, compose, 'utf-8');
}

function mergeIntoExistingCompose(existing, newVolumeLines, newServiceLines) {
  const lines = existing.split('\n');

  let volumesIdx = -1;
  let servicesIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === 'volumes:') volumesIdx = i;
    if (trimmed === 'services:') servicesIdx = i;
  }

  const findSectionEnd = (startIdx) => {
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].length > 0 && !lines[i].startsWith(' ') && !lines[i].startsWith('#')) {
        return i;
      }
    }
    return lines.length;
  };

  const insertServices = () => {
    if (newServiceLines.length === 0) return;
    if (servicesIdx >= 0) {
      const end = findSectionEnd(servicesIdx);
      lines.splice(end, 0, newServiceLines.join('\n'));
    } else {
      lines.push('', 'services:', ...newServiceLines.flatMap((b) => b.split('\n')));
    }
  };

  const insertVolumes = () => {
    if (newVolumeLines.length === 0) return;
    if (volumesIdx >= 0) {
      let volEnd = volumesIdx + 1;
      for (let i = volumesIdx + 1; i < lines.length; i++) {
        if (lines[i].length > 0 && !lines[i].startsWith(' ') && !lines[i].startsWith('#')) {
          volEnd = i;
          break;
        }
        volEnd = i + 1;
      }
      lines.splice(volEnd, 0, newVolumeLines.join('\n'));
    } else {
      lines.unshift('volumes:', ...newVolumeLines.flatMap((b) => b.split('\n')), '');
    }
  };

  // Insert the later section first to avoid invalidating indices of the earlier one
  if (volumesIdx > servicesIdx) {
    insertVolumes();
    insertServices();
  } else {
    insertServices();
    insertVolumes();
  }

  return lines.join('\n');
}

/** Substitutes `__VAR__` variables in a template text block. */
function substituteVars(text, { service, tag, ports, projectName, serviceConfigs, serviceName }) {
  let result = text;

  // Replace service-name placeholder: each service block uses {type}-__SVC__ as its key.
  result = result.replace(new RegExp(`${service}-__SVC__`, 'g'), serviceName);
  result = result.replace(/__CONTAINER_NAME__/g, `${projectName}_${serviceName}`);
  result = result.replace(/__TAG__/g, tag);
  result = result.replace(/__PROJECT__/g, projectName);

  for (const [internalPort, externalPort] of Object.entries(ports)) {
    result = result.replace(new RegExp(`__PORT_${internalPort}__`, 'g'), String(externalPort));
  }

  const imageName = serviceConfigs[service]?.imageName;
  if (imageName) {
    result = result.replace(/__IMAGE__/g, imageName);
  }

  // PostgreSQL
  if (service === 'postgres' && serviceConfigs.postgres) {
    result = result.replace(/__POSTGRES_PASSWORD__/g, serviceConfigs.postgres.password);
  }

  // MySQL
  if (service === 'mysql' && serviceConfigs.mysql) {
    const m = serviceConfigs.mysql;
    result = result
      .replace(/__MYSQL_ROOT_PASSWORD__/g, m.rootPassword)
      .replace(/__MYSQL_DATABASE__/g, m.database)
      .replace(/__MYSQL_USER__/g, m.user)
      .replace(/__MYSQL_PASSWORD__/g, m.password);
  }

  // MariaDB
  if (service === 'mariadb' && serviceConfigs.mariadb) {
    const m = serviceConfigs.mariadb;
    result = result
      .replace(/__MARIADB_ROOT_PASSWORD__/g, m.rootPassword)
      .replace(/__MARIADB_DATABASE__/g, m.database)
      .replace(/__MARIADB_USER__/g, m.user)
      .replace(/__MARIADB_PASSWORD__/g, m.password);
  }

  // MSSQL
  if (service === 'mssql' && serviceConfigs.mssql) {
    result = result.replace(/__MSSQL_SA_PASSWORD__/g, serviceConfigs.mssql.saPassword);
  }

  // Kafka UI
  if (service === 'kafka-ui') {
    result = result.replace(/__KAFKA_SERVICE__/g, serviceConfigs['kafka-ui'].kafkaServiceName);
  }

  // Redpanda Console
  if (service === 'redpanda-console') {
    result = result.replace(
      /__REDPANDA_SERVICE__/g,
      serviceConfigs['redpanda-console'].redpandaServiceName
    );
  }

  // RabbitMQ
  if (service === 'rabbitmq' && serviceConfigs.rabbitmq) {
    result = result
      .replace(/__RABBITMQ_USER__/g, serviceConfigs.rabbitmq.user)
      .replace(/__RABBITMQ_PASSWORD__/g, serviceConfigs.rabbitmq.password);
  }

  // Mailpit
  if (service === 'mailpit' && serviceConfigs.mailpit) {
    const mp = serviceConfigs.mailpit;
    result = result
      .replace(/__MAILPIT_UI_AUTH__/g, mp.uiAuth)
      .replace(/__MAILPIT_SEND_API_AUTH__/g, mp.sendApiAuth)
      .replace(/__MAILPIT_SMTP_AUTH__/g, mp.smtpAuth);
  }

  // Keycloak
  if (service === 'keycloak') {
    const kc = serviceConfigs.keycloak;
    const vendor = KEYCLOAK_DB_VENDORS[kc.dbVendor];

    result = result
      .replace(/__KC_DB_VENDOR__/g, vendor.kcDb)
      .replace(/__KC_DB_SERVICE__/g, kc.dbServiceName)
      .replace(/__KC_DB_PORT__/g, String(vendor.port))
      .replace(/__KEYCLOAK_DB_NAME__/g, kc.dbName)
      .replace(/__KEYCLOAK_DB_USER__/g, kc.dbUser)
      .replace(/__KEYCLOAK_DB_PASSWORD__/g, kc.dbPassword)
      .replace(/__KEYCLOAK_BOOTSTRAP_ADMIN_USER__/g, kc.bootstrapUser)
      .replace(/__KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD__/g, kc.bootstrapPassword)
      .replace(/__KEYCLOAK_ADMIN_USER__/g, kc.adminUser)
      .replace(/__KEYCLOAK_ADMIN_PASSWORD__/g, kc.adminPassword);
  }

  return result;
}

// -- compose.yml update operations --------------------------------------------

/**
 * Parses compose.yml into structured blocks (section + name + line range).
 */
function parseComposeBlocks(content) {
  const lines = content.split('\n');
  const volumes = [];
  const services = [];
  let currentSection = null;
  let currentBlock = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^volumes:\s*$/.test(line)) {
      currentSection = 'volumes';
      currentBlock = null;
      continue;
    }
    if (/^services:\s*$/.test(line)) {
      currentSection = 'services';
      currentBlock = null;
      continue;
    }
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#')) {
      currentSection = null;
      currentBlock = null;
      continue;
    }

    const nameMatch = line.match(/^ {2}(\S+):$/);
    if (nameMatch && currentSection) {
      if (currentBlock) currentBlock.endLine = i - 1;
      currentBlock = { name: nameMatch[1], startLine: i, endLine: i };
      (currentSection === 'volumes' ? volumes : services).push(currentBlock);
    } else if (currentBlock && line.startsWith('  ')) {
      currentBlock.endLine = i;
    }
  }

  return { lines, volumes, services };
}

/** Removes services (and their volumes) from a compose.yml. */
async function removeFromCompose(composePath, serviceNames) {
  const content = await fs.readFile(composePath, 'utf-8');
  const parsed = parseComposeBlocks(content);
  const linesToRemove = new Set();

  for (const name of serviceNames) {
    // Remove service block
    const svcBlock = parsed.services.find((b) => b.name === name);
    if (svcBlock) {
      for (let i = svcBlock.startLine; i <= svcBlock.endLine; i++) linesToRemove.add(i);
    }

    // Remove corresponding volume block
    const volName = `${name}-data`;
    const volBlock = parsed.volumes.find((b) => b.name === volName);
    if (volBlock) {
      for (let i = volBlock.startLine; i <= volBlock.endLine; i++) linesToRemove.add(i);
    }
  }

  const result = parsed.lines
    .filter((_, i) => !linesToRemove.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^volumes:\s*\n\s*\n/m, '') // Remove empty volumes:
    .replace(/^services:\s*\n\s*$/m, ''); // Remove empty services:

  await fs.writeFile(composePath, result, 'utf-8');
}

/** Cleans up directories for removed services. */
async function cleanRemovedServiceDirs(destPath, removedNames) {
  for (const name of removedNames) {
    const dir = resolve(destPath, name);
    if (fs.existsSync(dir)) await fs.remove(dir);
  }

  // If all keycloak instances were removed, delete the scaffold folder
  const composePath = resolve(destPath, 'compose.yml');
  if (fs.existsSync(composePath)) {
    const content = await fs.readFile(composePath, 'utf-8');
    const hasKeycloak = extractServiceNames(content).some((n) => n.startsWith('keycloak-'));
    if (!hasKeycloak) {
      const kcDir = resolve(destPath, 'keycloak');
      if (fs.existsSync(kcDir)) await fs.remove(kcDir);
    }
  }
}

/** Applies edits to existing instances in compose.yml. */
async function applyEdits(destPath, edits, projectName) {
  const templatePath = resolve(__dirname, 'compose.template.yml');
  const templateContent = await fs.readFile(templatePath, 'utf-8');
  const composePath = resolve(destPath, 'compose.yml');

  for (const [oldName, edit] of Object.entries(edits)) {
    const content = await fs.readFile(composePath, 'utf-8');
    const parsed = parseComposeBlocks(content);

    // Generate new service block
    const svcBlock = extractLines(templateContent, edit.type);
    const newSvcText = substituteVars(svcBlock.join('\n'), {
      service: edit.type,
      tag: edit.imageTag,
      ports: edit.ports,
      projectName,
      serviceConfigs: { [edit.type]: { imageName: edit.imageName } },
      serviceName: edit.serviceName,
    });

    // Generate new volume block
    const volBlock = extractLines(templateContent, `${edit.type}-volumes`);
    const newVolText =
      volBlock.length > 0
        ? substituteVars(volBlock.join('\n'), {
            service: edit.type,
            tag: edit.imageTag,
            ports: edit.ports,
            projectName,
            serviceConfigs: { [edit.type]: { imageName: edit.imageName } },
            serviceName: edit.serviceName,
          })
        : null;

    // Replace service block
    const svcEntry = parsed.services.find((b) => b.name === oldName);
    if (svcEntry) {
      const lines = content.split('\n');
      lines.splice(
        svcEntry.startLine,
        svcEntry.endLine - svcEntry.startLine + 1,
        ...newSvcText.split('\n')
      );
      await fs.writeFile(composePath, lines.join('\n'), 'utf-8');
    }

    // Replace volume block if it exists
    if (newVolText) {
      const updatedContent = await fs.readFile(composePath, 'utf-8');
      const updatedParsed = parseComposeBlocks(updatedContent);
      const oldVolName = `${oldName}-data`;
      const volEntry = updatedParsed.volumes.find((b) => b.name === oldVolName);
      if (volEntry) {
        const lines = updatedContent.split('\n');
        lines.splice(
          volEntry.startLine,
          volEntry.endLine - volEntry.startLine + 1,
          ...newVolText.split('\n')
        );
        await fs.writeFile(composePath, lines.join('\n'), 'utf-8');
      }
    }

    // Rename directory if the name changed
    const newName = edit.serviceName;
    if (oldName !== newName) {
      const oldDir = resolve(destPath, oldName);
      const newDir = resolve(destPath, newName);
      if (fs.existsSync(oldDir)) await fs.move(oldDir, newDir, { overwrite: true });
    }
  }
}

/** Applies the addition of new tags to existing services. */
async function applyAdditions(destPath, additions, projectName) {
  const templatePath = resolve(__dirname, 'compose.template.yml');
  const templateContent = await fs.readFile(templatePath, 'utf-8');
  const composePath = resolve(destPath, 'compose.yml');

  const volumeLines = [];
  const serviceLines = [];

  for (const [type, addition] of Object.entries(additions)) {
    const { imageName, instances } = addition;

    for (const { tag, ports, serviceName } of instances) {
      // Create temporary serviceConfigs for substitution
      const tmpConfigs = { [type]: { imageName } };

      const volBlock = extractLines(templateContent, `${type}-volumes`);
      if (volBlock.length > 0) {
        volumeLines.push(
          substituteVars(volBlock.join('\n'), {
            service: type,
            tag,
            ports,
            projectName,
            serviceConfigs: tmpConfigs,
            serviceName,
          })
        );
      }

      const svcBlock = extractLines(templateContent, type);
      if (svcBlock.length > 0) {
        serviceLines.push(
          substituteVars(svcBlock.join('\n'), {
            service: type,
            tag,
            ports,
            projectName,
            serviceConfigs: tmpConfigs,
            serviceName,
          })
        );
      }

      // Create init directory for databases
      if (['postgres', 'mysql', 'mariadb'].includes(type)) {
        await fs.mkdirp(resolve(destPath, serviceName, 'init'));
      }
    }
  }

  if (volumeLines.length > 0 || serviceLines.length > 0) {
    const existing = await fs.readFile(composePath, 'utf-8');
    const merged = mergeIntoExistingCompose(existing, volumeLines, serviceLines);
    await fs.writeFile(composePath, merged, 'utf-8');
  }
}

// -- Post-generation tasks ----------------------------------------------------

async function createDbInitDirs(destPath, services, serviceConfigs) {
  for (const dbType of ['postgres', 'mysql', 'mariadb']) {
    if (!services.includes(dbType)) continue;
    for (const { serviceName } of serviceConfigs[dbType].instances) {
      await fs.mkdirp(resolve(destPath, serviceName, 'init'));
    }
  }
}

async function copyKeycloakInitSql(destPath, services, serviceConfigs) {
  if (!services.includes('keycloak')) return;

  const kc = serviceConfigs.keycloak;
  const dbVendor = kc.dbVendor;

  // Only copy init SQL for databases that support docker-entrypoint-initdb.d
  if (!['postgres', 'mysql', 'mariadb'].includes(dbVendor)) return;

  if (dbVendor === 'postgres') {
    // Existing SQL script for PostgreSQL
    const sqlSrcPath = resolve(destPath, 'keycloak', 'scripts', '01-init-keycloak.sql');
    if (!fs.existsSync(sqlSrcPath)) return;

    let content = await fs.readFile(sqlSrcPath, 'utf-8');
    content = content
      .replace(/__KEYCLOAK_DB_USER__/g, kc.dbUser)
      .replace(/__KEYCLOAK_DB_PASSWORD__/g, kc.dbPassword)
      .replace(/__KEYCLOAK_DB_NAME__/g, kc.dbName);

    const initDir = resolve(destPath, kc.dbServiceName, 'init');
    await fs.mkdirp(initDir);
    await fs.writeFile(resolve(initDir, '01-init-keycloak.sql'), content, 'utf-8');
    await fs.remove(sqlSrcPath);
  } else if (dbVendor === 'mysql' || dbVendor === 'mariadb') {
    // Generate equivalent SQL script for MySQL/MariaDB
    const sqlContent = [
      `CREATE DATABASE IF NOT EXISTS \`${kc.dbName}\`;`,
      `CREATE USER IF NOT EXISTS '${kc.dbUser}'@'%' IDENTIFIED BY '${kc.dbPassword}';`,
      `GRANT ALL PRIVILEGES ON \`${kc.dbName}\`.* TO '${kc.dbUser}'@'%';`,
      `FLUSH PRIVILEGES;`,
    ].join('\n');

    const initDir = resolve(destPath, kc.dbServiceName, 'init');
    await fs.mkdirp(initDir);
    await fs.writeFile(resolve(initDir, '01-init-keycloak.sql'), sqlContent, 'utf-8');

    // Clean up PostgreSQL template if it was copied
    const pgSqlPath = resolve(destPath, 'keycloak', 'scripts', '01-init-keycloak.sql');
    if (fs.existsSync(pgSqlPath)) await fs.remove(pgSqlPath);
  }
}

async function cleanUnusedFolders(destPath, services) {
  if (!services.includes('keycloak')) {
    await fs.remove(resolve(destPath, 'keycloak'));
  }
}
