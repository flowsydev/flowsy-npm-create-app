import fs from 'fs-extra';
import { resolve } from 'node:path';
import { blue, green, lightBlue, lightMagenta, magenta, cyan } from 'kolorist';

export function printBanner() {
  const banner = `

${blue('███████╗ ██╗      ██████╗  ██╗    ██╗  ██████╗  ██╗   ██╗')}
${blue('██╔════╝ ██║      ██╔═══██╗ ██║    ██║ ██╔═══██╗ ╚██╗ ██╔╝')}
${blue('█████╗   ██║      ██║   ██║ ██║ █╗ ██║ ╚█████╔╝  ╚████╔╝ ')}
${lightBlue('██╔══╝   ██║      ██║   ██║ ██║███╗██║  ╚═══██╗   ╚██╔╝  ')}
${lightBlue('██║      ███████╗ ╚██████╔╝ ╚███╔███╔╝ ██████╔╝    ██║   ')}
${lightBlue('╚═╝      ╚══════╝  ╚═════╝   ╚══╝╚══╝  ╚═════╝     ╚═╝   ')}
                                           
${magenta('███╗   ██╗███████╗██╗    ██╗     █████╗ ██████╗ ██████╗ ')}
${magenta('████╗  ██║██╔════╝██║    ██║    ██╔══██╗██╔══██╗██╔══██╗')}
${magenta('██╔██╗ ██║█████╗  ██║ █╗ ██║    ███████║██████╔╝██████╔╝')}
${lightMagenta('██║╚██╗██║██╔══╝  ██║███╗██║    ██╔══██║██╔═══╝ ██╔═══╝ ')}
${lightMagenta('██║ ╚████║███████╗╚███╔███╔╝    ██║  ██║██║     ██║     ')}
${lightMagenta('╚═╝  ╚═══╝╚══════╝ ╚══╝╚══╝     ╚═╝  ╚═╝╚═╝     ╚═╝     ')}
  `;
  console.log(banner);
}

export function getOSInfo() {
  const platform = process.platform;
  switch (platform) {
    case 'win32':
      return { name: 'Windows', isWindows: true, isMac: false, isLinux: false };
    case 'darwin':
      return { name: 'macOS', isWindows: false, isMac: true, isLinux: false };
    case 'linux':
      return { name: 'Linux', isWindows: false, isMac: false, isLinux: true };
    default:
      return { name: 'Unix', isWindows: false, isMac: false, isLinux: true };
  }
}

export function printDirectoryTree(dir, prefix = '', maxDepth = 2, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];

  const items = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const filtered = entries
      .filter((entry) => {
        // Excluir node_modules, .git y archivos ocultos en la raíz
        if (currentDepth === 0 && (entry.name === 'node_modules' || entry.name === '.git'))
          return false;
        if (entry.name.startsWith('.') && currentDepth === 0) return false;
        return true;
      })
      .sort((a, b) => {
        // Directorios primero, luego archivos
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

    filtered.forEach((entry, index) => {
      const isLast = index === filtered.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const itemPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        items.push(`${prefix}${connector}${cyan(entry.name + '/')}`);
        const newPrefix = prefix + (isLast ? '    ' : '│   ');
        items.push(...printDirectoryTree(itemPath, newPrefix, maxDepth, currentDepth + 1));
      } else {
        items.push(`${prefix}${connector}${entry.name}`);
      }
    });
  } catch {
    // Ignorar errores de permisos
  }

  return items;
}

export function showProjectStructure(projectPath, projectName) {
  console.log(green(projectName + '/'));
  const tree = printDirectoryTree(projectPath, '', 2, 0);
  tree.forEach((line) => console.log(line));
  console.log();
}
