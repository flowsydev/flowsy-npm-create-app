#!/usr/bin/env node
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'fs-extra';
import prompts from 'prompts';
import { green, cyan, yellow, red } from 'kolorist';
import { execSync } from 'node:child_process';
import { printBanner, getOSInfo, showProjectStructure } from './util.js';

// -- Constants ----------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');

/** Available template catalog. */
const TEMPLATES = {
  infraKit: {
    id: 'infra-kit',
    description: 'InfraKit: Databases, Messaging & Identity in Containers',
  },
};

/** Shared handler: aborts when the user cancels a prompt. */
const onCancel = () => {
  throw new Error('Operation cancelled');
};

// -- Dynamic template loading -------------------------------------------------

function getTemplateScaffoldPath(templateName) {
  return resolve(TEMPLATES_DIR, templateName, 'scaffold');
}

/**
 * Dynamically imports a template's config.js module.
 * If the template has no config.js, returns empty stubs.
 */
async function loadTemplateModule(templateName) {
  const configPath = resolve(TEMPLATES_DIR, templateName, 'config.js');
  if (!fs.existsSync(configPath)) {
    return {
      getPrompts: () => [],
      configure: async () => {},
    };
  }

  const moduleUrl = pathToFileURL(configPath).href;
  const templateModule = await import(moduleUrl);
  return {
    getPrompts:
      typeof templateModule.getPrompts === 'function' ? templateModule.getPrompts : () => [],
    collectConfig:
      typeof templateModule.collectConfig === 'function' ? templateModule.collectConfig : null,
    configure:
      typeof templateModule.configure === 'function' ? templateModule.configure : async () => {},
    parseExistingCompose:
      typeof templateModule.parseExistingCompose === 'function'
        ? templateModule.parseExistingCompose
        : null,
  };
}

// -- Helpers ------------------------------------------------------------------

const relativeToCwd = (p) => {
  if (!p) return '.';
  try {
    const abs = resolve(p);
    const rel = relative(process.cwd(), abs);
    return rel === '' ? '.' : rel;
  } catch {
    return p;
  }
};

// -- Post-creation instructions -----------------------------------------------

function printNextSteps(dest, template) {
  const displayDest = relativeToCwd(dest);
  console.log(`Next steps:`);
  console.log(`  cd ${cyan(displayDest)}`);

  if (template !== TEMPLATES.infraKit.id) return;

  console.log(green('  1. Read the README.md for usage details and troubleshooting.\n'));
  console.log(green('  2. Review and adjust compose.yml to your needs before starting.'));

  const osInfo = getOSInfo();

  if (osInfo.isWindows) {
    console.log(`  .\\start.ps1`);
    console.log(`\n${cyan('Note:')} If you encounter issues with the execution policy, run:`);
    console.log(`  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser\n`);
  } else {
    console.log(`  chmod u+x start.sh stop.sh`);
    console.log(`  ./start.sh\n`);
  }

  console.log(`  ${cyan('Alternatively, you can use Docker/Podman directly:')}`);
  console.log(`  podman compose up -d`);
  console.log(`  ${yellow('or')}`);
  console.log(`  docker compose up -d\n`);
}

// -- Main flow ----------------------------------------------------------------

async function main() {
  printBanner();

  // Optional args: npx @flowsydev/create-app <name> <destination-dir>
  const [, , argProjectName, argDestinationDir] = process.argv;
  const targetDir = argProjectName?.trim();
  const destinationDirArg = argDestinationDir?.trim();

  // Step 1 - Template selection
  const { template } = await prompts(
    {
      type: 'select',
      name: 'template',
      message: 'Application type:',
      choices: [
        {
          title: TEMPLATES.infraKit.description,
          value: TEMPLATES.infraKit.id,
        },
      ],
      initial: 0,
    },
    { onCancel }
  );

  // Step 2 - Project name
  const { projectName: promptedName } = await prompts(
    {
      type: targetDir ? null : 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: `my-${template}`,
    },
    { onCancel }
  );
  const projectName = targetDir ?? promptedName;

  // Step 3 - Destination folder
  const { destinationDir: promptedDest } = await prompts(
    {
      type: destinationDirArg ? null : 'text',
      name: 'destinationDir',
      message: 'Destination folder (relative to current directory):',
      initial: relativeToCwd(process.cwd()),
      format: (value) => value?.trim(),
    },
    { onCancel }
  );

  const destinationBaseDir =
    (destinationDirArg ?? promptedDest)
      ? resolve(process.cwd(), destinationDirArg ?? promptedDest)
      : process.cwd();

  if (fs.existsSync(destinationBaseDir)) {
    const stat = await fs.stat(destinationBaseDir);
    if (!stat.isDirectory()) {
      throw new Error(`The destination path is not a folder: ${relativeToCwd(destinationBaseDir)}`);
    }
  } else {
    await fs.mkdirp(destinationBaseDir);
  }

  const dest = resolve(destinationBaseDir, projectName);
  const templateModule = await loadTemplateModule(template);

  // Step 4 - Detect update mode (folder with existing compose.yml)
  let existingServices = new Set();
  let existingDetails = null;
  const isUpdate = fs.existsSync(resolve(dest, 'compose.yml'));

  if (isUpdate && typeof templateModule.parseExistingCompose === 'function') {
    existingDetails = await templateModule.parseExistingCompose(dest);
    existingServices = existingDetails.serviceTypes;

    if (existingServices.size > 0) {
      console.log(`\n${cyan('Update mode:')} existing services:\n`);
      for (const [type, instances] of existingDetails.instances) {
        console.log(`  ${green(type)}`);
        for (const inst of instances) {
          const portsStr = Object.entries(inst.ports)
            .map(([int, ext]) => `${ext}->${int}`)
            .join(', ');
          console.log(`    ${inst.serviceName}  ${cyan(inst.image)}  [${portsStr}]`);
        }
      }
      console.log();
    }
  }

  // Step 5 - Template-specific prompts (e.g. service selection or actions)
  const templatePrompts = templateModule.getPrompts({ existingServices });
  let templateConfig = {};

  if (templatePrompts.length > 0) {
    templateConfig = await prompts(templatePrompts, { onCancel });
  }

  // Step 6 - Detailed template configuration (images, versions, ports, credentials)
  let enrichedConfig = templateConfig;
  if (typeof templateModule.collectConfig === 'function') {
    enrichedConfig = await templateModule.collectConfig(templateConfig, {
      existingServices,
      existingDetails,
      destPath: dest,
    });
  }

  // Step 7 - Confirmation and destination folder preparation
  if (isUpdate) {
    const newServices = enrichedConfig.services ?? [];
    const removals = enrichedConfig.removals ?? [];
    const edits = enrichedConfig.edits ?? {};
    const additions = enrichedConfig.additions ?? {};
    const hasChanges =
      newServices.length > 0 ||
      removals.length > 0 ||
      Object.keys(edits).length > 0 ||
      Object.keys(additions).length > 0;

    if (!hasChanges) {
      console.log(yellow('\nNo changes selected. Nothing to do.'));
      process.exit(0);
    }

    // Changes summary
    const summary = [];
    if (newServices.length > 0) summary.push(`add: ${newServices.map((s) => green(s)).join(', ')}`);
    if (Object.keys(additions).length > 0)
      summary.push(
        `new instances: ${Object.keys(additions)
          .map((s) => green(s))
          .join(', ')}`
      );
    if (Object.keys(edits).length > 0)
      summary.push(
        `edit: ${Object.keys(edits)
          .map((s) => cyan(s))
          .join(', ')}`
      );
    if (removals.length > 0) summary.push(`remove: ${removals.map((s) => red(s)).join(', ')}`);
    console.log(`\nChanges to apply: ${summary.join(' | ')}\n`);
  } else if (fs.existsSync(dest)) {
    const { overwrite } = await prompts(
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'The folder already exists. Overwrite?',
        initial: false,
      },
      { onCancel }
    );

    if (overwrite === false) {
      console.log(yellow('Aborted'));
      process.exit(1);
    }
    await fs.emptyDir(dest);
  }

  if (!isUpdate) {
    // Copy scaffold only in creation mode
    const src = getTemplateScaffoldPath(template);
    if (!fs.existsSync(src)) {
      console.log(red(`Scaffold not found for template: ${template}`));
      process.exit(1);
    }
    await fs.copy(src, dest);
  }

  await templateModule.configure(dest, enrichedConfig);

  // Step 8 - Post-processing
  const gi = resolve(dest, '_gitignore');
  if (fs.existsSync(gi)) await fs.move(gi, resolve(dest, '.gitignore'));

  for (const p of ['.idea', '.vscode', 'dist', 'node_modules']) {
    const fullPath = resolve(dest, p);
    if (fs.existsSync(fullPath)) await fs.remove(fullPath);
  }

  // Adjust README title
  const readmePath = resolve(dest, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readmeContent = await fs.readFile(readmePath, 'utf-8');
    const lines = readmeContent.split(/\r?\n/);
    const titleIdx = lines.findIndex((line) => /^#\s+.+/.test(line));

    if (titleIdx >= 0) {
      lines[titleIdx] = `# ${projectName}`;
    } else {
      lines.unshift(`# ${projectName}`, '');
    }

    await fs.writeFile(readmePath, lines.join('\n'));
  }

  // Adjust package.json and install dependencies (if applicable)
  const pkgPath = resolve(dest, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    pkg.name = projectName;
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

    console.log('\nInstalling dependencies...');
    try {
      execSync('npm install', { stdio: 'inherit', cwd: dest });
    } catch {
      console.log(yellow('Failed to install dependencies. Please run "npm install" manually.'));
      process.exit(0);
    }

    console.log('\nFormatting code...');
    try {
      execSync('npm run format', { stdio: 'inherit', cwd: dest });
    } catch {
      console.log(
        yellow('Failed to format code automatically. Please run "npm run format" manually.')
      );
      process.exit(0);
    }
  }

  // Step 9 - Git initialization (optional, only in creation mode)
  if (!isUpdate) {
    const { initGit } = await prompts(
      {
        type: 'confirm',
        name: 'initGit',
        message: 'Initialize a Git repository?',
        initial: false,
      },
      { onCancel }
    );

    if (initGit) {
      console.log('\nInitializing Git repository...');
      try {
        execSync('git init', { stdio: 'ignore', cwd: dest });
      } catch {
        console.log(yellow('Failed to initialize Git repository.'));
      }
    }
  }

  // Step 10 - Final summary
  const displayDest = relativeToCwd(dest);
  console.log(
    isUpdate
      ? `\n✅ Project updated in ${cyan(displayDest)}\n`
      : `\n✅ Project created in ${cyan(displayDest)}\n`
  );
  showProjectStructure(dest, projectName);
  printNextSteps(dest, template);
}

main().catch((e) => {
  console.error(red(String(e?.message ?? e)));
  process.exit(1);
});
