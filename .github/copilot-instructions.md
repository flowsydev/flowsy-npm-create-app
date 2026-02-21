# Copilot Instructions for @flowsydev/create-app

## Project Overview

This is an npx-style CLI tool for scaffolding applications (similar to create-react-app or create-vue). Users run `npx @flowsydev/create-app my-app` to generate pre-configured project templates.

## Architecture

### Entry Points & Code State

- **Active**: [bin/cli.js](../bin/cli.js) - Main CLI entry point (referenced in package.json)

### Template System

Templates are the core abstraction. Each template lives in `templates/<template-id>/`:

```text
templates/
  <template-id>/
    config.js        # Exports getPrompts() and configure() functions
    scaffold/        # Boilerplate files to copy to destination
```

**Template Module Contract** ([example](../templates/identity-provider/config.js)):

- `getPrompts()` - Returns array of prompts objects (using prompts library format)
- `configure(destPath, config)` - Post-copy customization (e.g., placeholder replacement)

**Currently Active Template**: `identity-provider` - Keycloak + PostgreSQL Docker Compose setup

## Key Conventions

### Placeholder Replacement Pattern

Templates use double-underscore placeholders that get replaced during `configure()`:

```javascript
__POSTGRES_VERSION__  → config.postgresVersion
__PROJECT_NAME__      → basename(destPath)
__KEYCLOAK_PORT__     → config.keycloakPort
```

Only specific files are processed (see `filesToProcess` array in config.js).

### File Naming Conventions

- `_gitignore` in scaffolds → renamed to `.gitignore` after copy (avoids npm publish issues)
- Excluded paths auto-removed: `.idea`, `.vscode`, `dist`, `node_modules`

### CLI Flow

1. Print banner ([bin/util.js](../bin/util.js))
2. Select template
3. Prompt for project name & destination
4. Load template module dynamically via `pathToFileURL` + dynamic import
5. Show template-specific prompts
6. Confirm Git init & overwrite handling
7. Copy scaffold → configure → adjust package.json/README.md
8. Run `npm install` + `npm run format` if package.json exists
9. Display platform-specific next steps (Windows PowerShell vs Unix shell)

## Development Workflows

### Testing Locally

```bash
npm start      # Run CLI directly
npm run pub    # Publish to npm (requires access)
```

To test as end-user would:

```bash
npm link       # Create global symlink
npx @flowsydev/create-app test-project
```

### Adding a New Template

1. Create `templates/<new-template-id>/` directory
2. Add `scaffold/` subdirectory with boilerplate files
3. Create `config.js` with `getPrompts()` and `configure()` exports
4. Register template in [bin/cli.js](../bin/cli.js) `templates` object (line ~33)
5. Add platform-specific instructions in final switch statement (line ~277)

### Module System

- **ESM only** (`"type": "module"` in package.json)
- Use `import.meta.url` for meta information
- Dynamic imports via `pathToFileURL().href`
- Requires Node.js >=18

## Dependencies

- `prompts` - Interactive CLI prompts
- `kolorist` - Colored terminal output (use cyan/green/yellow/red/magenta)
- `fs-extra` - Enhanced file operations (copy, emptyDir, mkdirp)
- Uses Node's `execSync` for running npm/git commands in child processes

## Cross-Platform Considerations

OS detection via [bin/util.js](../bin/util.js) `getOSInfo()` returns:

```javascript
{
  name: ('Windows' | 'macOS' | 'Linux', isWindows, isMac, isLinux);
}
```

Different instructions for Windows (PowerShell scripts: `start.ps1`) vs Unix (shell scripts: `start.sh` with chmod).

## Error Handling Patterns

- Use `yellow()` for non-fatal warnings ("Failed to format code...")
- Use `red()` for fatal errors
- Always provide manual fallback instructions when exec commands fail
- `onCancel` handlers throw errors to exit gracefully
