#!/usr/bin/env node
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'fs-extra';
import prompts from 'prompts';
import { green, cyan, yellow, red } from 'kolorist';
import { execSync } from 'node:child_process';
import { printBanner, getOSInfo, showProjectStructure } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '..', 'templates');

async function main() {
  printBanner();

  // args: my-cool-app /ruta/o/carpeta-destino
  const [, , argProjectName, argDestinationDir] = process.argv;
  let targetDir = argProjectName?.trim();
  let destinationDirArg = argDestinationDir?.trim();

  const templates = {
    identityProvider: {
      id: 'identity-provider',
      description: 'Identity Provider (Keycloak + PostgreSQL in Containers)',
    },
  };

  function onCancel() {
    throw new Error('Operation cancelled');
  }

  // Step 1: Basic prompts
  const basicResponse = await prompts(
    [
      {
        type: 'select',
        name: 'template',
        message: 'Application type:',
        choices: [
          {
            title: templates.identityProvider.description,
            value: templates.identityProvider.id,
          },
        ],
        initial: 0,
      },
    ],
    {
      onCancel,
    }
  );

  const projectNameResponse = await prompts(
    [
      {
        type: targetDir ? null : 'text',
        name: 'projectName',
        message: 'Project name:',
        initial: `my-${basicResponse.template}`,
      },
    ],
    {
      onCancel,
    }
  );

  // helper to show a path relative to the current working directory
  const relativeToCwd = (p) => {
    if (!p) return '.';
    try {
      // resolve to absolute first
      const abs = resolve(p);
      const rel = relative(process.cwd(), abs);
      return rel === '' ? '.' : rel;
    } catch {
      return p;
    }
  };

  const destinationResponse = await prompts(
    [
      {
        type: destinationDirArg ? null : 'text',
        name: 'destinationDir',
        message: 'Destination folder (relative to current directory):',
        initial: relativeToCwd(process.cwd()),
        format: (value) => value?.trim(),
      },
    ],
    {
      onCancel,
    }
  );

  const destinationBaseDirInput = destinationDirArg ?? destinationResponse.destinationDir;
  const destinationBaseDir = destinationBaseDirInput
    ? resolve(process.cwd(), destinationBaseDirInput)
    : process.cwd();

  if (fs.existsSync(destinationBaseDir)) {
    const destinationStat = await fs.stat(destinationBaseDir);
    if (!destinationStat.isDirectory()) {
      throw new Error(`The destination path is not a folder: ${relativeToCwd(destinationBaseDir)}`);
    }
  } else {
    await fs.mkdirp(destinationBaseDir);
  }

  // Step 2: Template-specific prompts
  const templateModule = await loadTemplateModule(basicResponse.template);
  const templatePrompts = templateModule.getPrompts();
  let templateConfig = {};

  if (templatePrompts.length > 0) {
    templateConfig = await prompts(templatePrompts, {
      onCancel,
    });
  }

  // Step 3: Final confirmation and options
  const projectName = targetDir ?? projectNameResponse.projectName;
  const finalResponse = await prompts(
    [
      {
        type: 'confirm',
        name: 'initGit',
        message: 'Initialize a Git repository?',
        initial: false,
      },
      {
        type: (_prev, _values) => {
          const dest = resolve(destinationBaseDir, projectName);
          return fs.existsSync(dest) ? 'confirm' : null;
        },
        name: 'overwrite',
        message: (_prev) => `The folder already exists. Overwrite?`,
        initial: false,
      },
    ],
    {
      onCancel,
    }
  );

  // Merge all responses
  const response = { ...basicResponse, ...templateConfig, ...finalResponse };
  const template = response.template;
  const dest = resolve(destinationBaseDir, projectName);

  if (response.overwrite === false) {
    console.log(
      yellow('Aborted: The destination folder already exists and will not be overwritten.')
    );
    process.exit(1);
  }
  if (response.overwrite) await fs.emptyDir(dest);

  const templateScaffoldDir = getTemplateScaffoldPath(template);
  if (!fs.existsSync(templateScaffoldDir)) {
    console.log(red(`Scaffold not found for template: ${template}`));
    process.exit(1);
  }

  // Copy template scaffold to destination
  await fs.copy(templateScaffoldDir, dest);

  // Configure the template with the provided values
  await templateModule.configure(dest, response);

  // Rename _gitignore -> .gitignore
  const gi = resolve(dest, '_gitignore');
  if (fs.existsSync(gi)) await fs.move(gi, resolve(dest, '.gitignore'));

  const excludedPaths = ['.idea', '.vscode', 'dist', 'node_modules'];
  for (const p of excludedPaths) {
    const fullPath = resolve(dest, p);
    if (fs.existsSync(fullPath)) {
      await fs.remove(fullPath);
    }
  }

  const readmePath = resolve(dest, 'README.md');
  const hasReadme = fs.existsSync(readmePath);

  if (hasReadme) {
    const readmeContent = await fs.readFile(readmePath, 'utf-8');
    const readmeLines = readmeContent.split(/\r?\n/);
    const readmeTitleIndex = readmeLines.findIndex((line) => /^#\s+.+/.test(line));

    if (readmeTitleIndex >= 0) {
      readmeLines[readmeTitleIndex] = `# ${projectName}`;
    } else {
      readmeLines.unshift(`# ${projectName}`, '');
    }

    await fs.writeFile(readmePath, readmeLines.join('\n'));
  }

  const pkgPath = resolve(dest, 'package.json');
  const hasPackageJson = fs.existsSync(pkgPath);

  if (hasPackageJson) {
    // Adjust package.json (name)
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    pkg.name = projectName;
    await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));

    // Run npm install
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

  if (response.initGit) {
    console.log('\nInitializing Git repository...');
    try {
      execSync('git init', { stdio: 'ignore', cwd: dest });
    } catch {
      console.log(yellow("Failed to initialize Git repository. Please run 'git init' manually."));
    }
  }

  // Final message
  const displayDest = relativeToCwd(dest);
  console.log(`\n✅ Project created in ${cyan(displayDest)}\n`);

  // Show project structure
  showProjectStructure(dest, projectName);

  console.log(`Next steps:`);
  console.log(`  cd ${cyan(displayDest)}`);

  const osInfo = getOSInfo();

  switch (template) {
    case templates.identityProvider.id: {
      console.log(green('  Read the README.md and compose.yml files of the project.'));

      if (osInfo.isWindows) {
        console.log(`  .\\start.ps1`);
        console.log(`\n${cyan('Note:')} If you encounter issues with the execution policy, run:`);
        console.log(`  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser\n`);
      } else {
        console.log(`  chmod u+x start.sh ./stop.sh`);
        console.log(`  ./start.sh <docker|podman>\n`);
      }
      console.log(`  ${cyan('Alternatively, you can use Docker/Podman directly:')}`);
      console.log(`  docker compose up -d`);
      console.log(`  ${yellow('or')}`);
      console.log(`  podman compose up -d\n`);
      break;
    }
    default:
      break;
  }
}

main().catch((e) => {
  console.error(red(String(e?.message ?? e)));
  process.exit(1);
});

function getTemplateScaffoldPath(templateName) {
  return resolve(TEMPLATES_DIR, templateName, 'scaffold');
}

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
    configure:
      typeof templateModule.configure === 'function' ? templateModule.configure : async () => {},
  };
}
