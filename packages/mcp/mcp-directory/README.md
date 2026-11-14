---
description: "Curated directory of MCP servers, OAuth connectors, website sessions and skills, turned on with one choice."
kind: "package-reference"
---

# @hackdevcode/dsh-mcp-directory

## Summary

A built-in directory of well-known MCP servers (GitHub, Playwright and Chrome DevTools browsers, filesystem, Git, fetch, memory, sequential thinking, time, documentation servers and web search), OAuth connectors, and website sessions: any website the person signed in to in a browser profile kept for Hack Dev Code. A server, connector or session the person turns on runs as its own [mcp-client](../mcp-client/README.md) instance, started and stopped live, with its tools in an on-demand group so they cost nothing until an agent loads them.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The base bundle mounts the directory with nothing turned on:

```yaml
- id: mcp-directory
  name: '@hackdevcode/dsh-mcp-directory'
```

Turn servers on in Settings (the `servers` field of this entry), or ask an agent ("add the GitHub MCP server"), which calls `mcp_directory`. Each choice is stored under `servers.<id>`:

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Run the server. |
| `env` | — | Values for the keys the server needs, such as `GITHUB_PERSONAL_ACCESS_TOKEN` or `BRAVE_API_KEY`; a key left out is read from the environment Hack Dev Code started in. Settings shows these as secrets. |
| `roots` | the start folder | Folders a folder-opening server (filesystem) may use. |

Servers start with `npx` (Node.js) or `uvx` (Python uv), which download them on first start; GitHub uses its hosted HTTP endpoint.

The same package offers a skill directory: open-licensed skills (MCP server building, web app testing, frontend design, Word, Excel, PowerPoint and PDF files, skill writing and more) that `skill_directory` installs into `$DSH_HOME/skills` with a shallow, sparse Git checkout of just the skill's folder. The skill loader watches that folder, so an installed skill is available at once. Each installed folder carries a `.hackdev-directory` marker, and removal only deletes folders that have it.

### Website sessions

`sites.<id>` holds `{ enabled, title?, url }`. Adding one (the Customize page, or `site_connector` with action `add`) opens the installed Chrome, Edge or Chromium on a profile of its own under `$DSH_HOME/site-sessions/<id>/profile`; the person signs in there and closes the window. The session then mounts as a Playwright MCP server on that same profile (tool group `mcp-<id>`), so an agent acts in a browser that is already signed in. No password passes through Hack Dev Code. `site_connector` action `learn` appends what an agent worked out about the website to `site-sessions/<id>/PLAYBOOK.md` (at most 20,000 characters).

### Built-in skills

Six skills ship in the package and are provided from memory, with nothing to install: `code-review`, `systematic-debugging`, `test-first`, `git-commit-and-pr`, `security-review` and `web-research`. Each website session also provides a skill, `site-<id>`, with how to use that session, the rules for acting as the person, and the session's playbook. They rank as bundled skills, so a skill of the same name in the person's or the project's skill folder wins.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/catalog.ts](src/catalog.ts) | The curated servers: launch command or URL, required keys, folder arguments |
| [src/skills.ts](src/skills.ts) | The curated skills and their Git install and removal |
| [src/builtin-skills.ts](src/builtin-skills.ts) | The skills that ship in the package |
| [src/sites.ts](src/sites.ts) | Website sessions: reading a link, naming the session, finding a browser, the sign-in window and the client config on the same profile, and the session's skill text |
| [src/index.ts](src/index.ts) | Builds each chosen server's mcp-client config, mounts and remounts clients on `loader/volatile-update`, and registers `mcp_directory` |

A choice whose required keys are missing mounts nothing and is reported as `needs <KEY>`. A changed choice disposes the running client and starts a new one; the clients are child plugins, so unloading the directory stops them. Saving goes through `settings.update` on this entry, so it persists in the profile patch like any Settings edit.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [MCP client](../mcp-client/README.md) — one server connection, tool registration and reconnects.
- [Settings](../../settings/settings/README.md) — volatile fields and their persistence.

<a id="model-experience"></a>
## Model Experience

### The skill_directory tool

#### What the model sees

One tool, `skill_directory`, with `action` `list`, `install` or `remove`. `list` returns one line per skill: `id (Title) [installed|not installed|a folder of this name exists]: description (license)`; `install` says where the skill went and that it loads by its name. Its description tells the model to install a skill only when the person asks.

#### Token effect

One small tool definition on every request; an installed skill adds its catalog line like any other skill.

#### KV Cache effect

The tool definition is stable. An installed skill changes the skill catalog once.

### The mcp_directory tool

#### What the model sees

One tool, `mcp_directory`, with `action` `list`, `add` or `remove`. `list` returns one line per server: `id (Title) [on|off|on, needs KEY]: description`, plus the keys it needs. `add` replies with how to load the server's tools (the group `mcp-<id>`, tools named `mcp__<id>__<tool>`), or asks for a missing key. Its description tells the model to add a server only when the person asks.

#### Token effect

One small tool definition on every request. A turned-on server adds nothing until its group is loaded; then its tools cost what the server's own definitions cost.

#### KV Cache effect

The tool definition is stable. Loading a server's group changes the tool prefix once.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Downloads third-party code** — turning a server on runs that server's published package; the catalog lists well-known servers, but their code is not reviewed here.
- **Runtimes** — `npx` servers need Node.js and `uvx` servers need Python's uv on the PATH; a missing runtime shows as a connection error in the log.
- **Keys in the profile** — a key passed through `env` is stored in the profile patch (shown redacted in Settings); setting it in the environment instead keeps it out of the file.
- **Connector sign-in is per service** — a connector works when its service lets a new client register itself; each listed address answers as an OAuth-protected MCP server, but the sign-in of each service has not been exercised here.
- **Website sessions** — need Chrome, Edge or Chromium installed and Node.js for the browser server. A website may end a session or show a verification challenge, which the person finishes in the sign-in window; the profile can be used by one browser at a time, so the sign-in window must be closed before an agent uses the session. Whether automated use of an account is allowed is up to that website's terms.
- **Fixed catalog** — the lists ship with the package; other servers are added as ordinary mcp-client rows, other skills as folders in the skill folder.
- **Skills need Git and network access** — installation clones from GitHub; a skill's own scripts may need Python or Node.js packages, which its SKILL.md names.
