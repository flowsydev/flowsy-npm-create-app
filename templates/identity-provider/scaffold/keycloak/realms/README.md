# Realm JSON files

Drop your Keycloak realm JSON files in this directory.

Rules:

- Use the `.json` extension.
- Each file must define a top‑level `"realm"` field.
- On startup, only realms that do not already exist in Keycloak are imported.
- If a realm already exists, its file is ignored.

Tip:

- Choose descriptive file names, e.g. `my-team-realm.json`.
