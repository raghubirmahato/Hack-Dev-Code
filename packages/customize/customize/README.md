---
description: "Remote gateway of the Customize settings area: reads and changes MCP servers, connectors and skills for a settings page."
kind: "package-reference"
---

# @hackdevcode/dsh-customize

## Summary

The Host side of the Customize settings area. It gives a settings page one Remote, `customize`, to read the directory of MCP servers, connectors and skills and to change it: turn a server on or off, store its keys and folders, add or remove a server of your own, sign in to or disconnect a connector, and install or remove a skill. It keeps no state; every call goes to [mcp-directory](../../mcp/mcp-directory/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts the gateway next to the directory:

```yaml
- id: customize
  name: '@hackdevcode/dsh-customize'
```

A browser plugin calls it through the generated face, `ctx.remote.customize`:

| Method | What it does |
| --- | --- |
| `read()` | Returns `{ servers, connectors, skills }` as they stand now. |
| `setServer(id, { enabled, keys?, roots? })` | Turns a server on or off and stores the keys and folders given. |
| `saveCustom(id, server)` / `removeCustom(id)` | Adds, replaces or removes one of the person's own servers. |
| `connect({ id, url?, title? })` | Adds a connector and starts its sign-in; returns `{ authorizeUrl }` when a browser step is needed. |
| `disconnect(id)` | Signs out of a connector and removes it. |
| `installSkill(id)` / `removeSkill(id)` | Installs or removes a directory skill. |

The Host emits `customize/changed` whenever the directory changes, whoever changed it, so an open page reads again.

<a id="understand-the-implementation"></a>
## Understand the implementation

`Customize` extends `TypertRemoteService` and resolves the directory with `ctx.get('mcpDirectory')` on each call, so a deployment without the directory still mounts the gateway. A call then fails with `customize/unavailable`; a change the directory refuses fails with `customize/failed` and the directory's own reason as the message. Key values travel one way only: `read()` reports whether a key is set, never its value.

<a id="further-exploration"></a>
## Further Exploration

- [MCP directory](../../mcp/mcp-directory/README.md): the catalog, the stored choices and the model tools.
- [Customize settings page](../client-ui-customize/README.md): the browser side.

<a id="model-experience"></a>
## Model Experience

None, as the package is a Remote gateway for a settings page and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Whole-snapshot reads**: `read()` returns all three lists each time; the lists are short, so there is no paging or partial update.
