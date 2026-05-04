# Realms JSON

Place your Keycloak realm JSON files in this folder.

Rules:

- Use the `.json` extension.
- Each file must define the root field `"realm"`.
- On each startup, only realms that do not exist in Keycloak are imported.
- If a realm already exists, its file is skipped.

Suggestion:

- Use descriptive file names, for example: `my-team-realm.json`.
