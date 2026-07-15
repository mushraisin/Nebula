# Nebula Launcher

A custom Electron launcher for Minecraft modpacks in the **Modrinth `.mrpack`** format.
Packs are pulled **automatically** from a built-in repository, so anyone who opens the
launcher sees them right away and installs them in one click.

> **Note — who this is for**
>
> Nebula was built **primarily for the [3adrypanka](https://moments.zadrypanka.xyz) Discord
> community**, and it ships pointing at that server's modpack repository by default.
>
> It is open source, so anyone else is welcome to use it: you can **edit or remove the
> bundled packs and point the launcher at your own source** (see
> [Using your own repository](#using-your-own-repository)). No part of it is tied to
> 3adrypanka beyond the default repository URL.

## Features

- **Automatic pack catalog** — the built-in repository is fetched on startup; available
  packs appear on the home screen. Click a card to select it, **Детально / Details** for
  the full page (media, description, changelog, mods).
- **Two ways to sign in**
  - **Microsoft / Xbox** (msmc) — licensed account, online servers, real skin head shown.
  - **Offline** — just pick a nickname (offline-UUID, as on `online-mode=false` servers).
  - Sessions persist between launches; multiple accounts can be saved and switched.
- **Incremental pack updates** — existing files are verified (sha1 for downloads, crc32 for
  overrides) and only missing/changed files are fetched. Files dropped from a pack are
  removed; **mods you added yourself are kept**.
- **Fast downloads** — parallel file downloads, multi-connection (segmented) transfer for
  large archives, and keep-alive connections.
- **Auto-Java** — the required JRE (8/17/21…) is detected from the MC version and fetched
  from Adoptium (Temurin).
- **All loaders** — Vanilla, Fabric, Quilt, Forge, NeoForge.
  - Fabric/Quilt/Vanilla via `minecraft-launcher-core`.
  - Forge/NeoForge via the official installer (`@xmcl`), processors run automatically.
- **Mod manager** — search Modrinth, install (with dependencies), enable/disable, remove.
- **Custom profiles** — create a plain Vanilla/Fabric/Quilt/NeoForge instance and add mods.
- **Discord Rich Presence** — shows *Playing Nebula* plus the pack name. No setup needed.
- **Theming** — customizable background/accent colours with presets, plus an optional
  **Liquid Glass** mode (frosted panels; off by default, easier on weak PCs).
- **Self-update** — the launcher updates itself from GitHub Releases.

## Running from source

```bash
npm install
npm start          # or: npm run dev  (with DevTools)
```

## Building the installer

```bash
npm run dist       # output in release/
```

Releases are normally built by CI: push a tag (`v2.4.1`) and the
[workflow](.github/workflows/build.yml) builds the Windows installer and attaches it to a
GitHub Release. The launcher's auto-updater reads that release feed.

## Using your own repository

The launcher ships with a built-in manifest URL:

```js
// src/main/repo.js
const BUILTIN_REPOS = [
  'https://moments.zadrypanka.xyz/launcher/packs.json'
];
```

Replace it with your own `packs.json` (or remove it entirely and let users add sources
themselves via **Add pack → Repository**). The manifest is a plain JSON list of packs:

```json
{
  "packs": [
    {
      "id": "my-pack",
      "name": "My Pack",
      "version": "1.0",
      "gameVersion": "1.21.1",
      "loader": "neoforge",
      "mrpack": "https://example.com/files/my-pack.mrpack",
      "summary": "Short one-line description",
      "description": "Full description for the Overview tab",
      "icon": "https://example.com/icon.png",
      "media": ["https://youtu.be/…", "https://i.imgur.com/….png"],
      "changelog": "## 1.0\n- first release"
    }
  ]
}
```

Bumping a pack's `version` in the manifest is what triggers the update badge for users.

Users can also add packs without any repository at all — **Add pack** accepts a direct
`.mrpack` URL or a local file.

## Optional: hosted admin API

The 3adrypanka deployment serves packs from its own site and exposes a small CRUD API so
packs can be managed from inside the launcher (Settings → Admin API + token → an **Admin**
button appears). This is entirely optional — the launcher works fine against any static
`packs.json`.

- `GET /launcher/packs.json` — public manifest.
- `GET /launcher/admin/verify` — token check.
- `POST /launcher/admin/packs` — create/update a pack (upsert by `id`).
- `DELETE /launcher/admin/packs/:id` — delete.

Admin routes are protected by `Authorization: Bearer <LAUNCHER_ADMIN_TOKEN>`. The token is
stored only in the user's local config — it is never bundled into the app.

## Data layout

Everything lives under `%APPDATA%/Nebula/`:

```
config.json          # accounts, settings, installed packs
data/
  shared/            # versions, libraries, assets (shared between packs)
  instances/<id>/    # mods, config, saves for each pack
  java/<major>/      # auto-installed JREs
```

## Notes / limitations

- **Forge/NeoForge**: the first install runs the official installer (processors) — this can
  take a few minutes and needs internet and Java (installed automatically).
- NeoForge for MC 1.20.1 uses the older `forge` naming — handled automatically.
- The Windows build is **not code-signed**, so SmartScreen may warn about an unknown
  publisher on first run.

## Stack

Electron, minecraft-launcher-core (Fabric/Quilt/Vanilla), @xmcl/core + @xmcl/installer
(Forge/NeoForge), msmc (Microsoft auth), @xmcl/unzip, adm-zip, Node native http/crypto.

## License

[MIT](LICENSE) © mushbarry
