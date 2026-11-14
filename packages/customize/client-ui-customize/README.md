---
description: "Customize section of Web Settings: pages for skills, connectors and MCP servers."
kind: "package-reference"
---

# @hackdevcode/dsh-client-ui-customize

## Summary

The **Customize** section of Settings. Three pages let a person give the agent more to work with: **Skills** shows the built-in skills and installs and removes directory skills, **Connectors** signs in to any website from a pasted link, signs in to services with a connector, or adds one by its MCP address, and **MCP servers** turns directory servers on and off, stores their keys and folders, and adds a server of your own from a command or an address. The plugin marketplace lives on the Plugins page under **Discover**.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts the section; it appears in Settings between Tools and Models:

```yaml
- id: ui-customize
  name: '@hackdevcode/dsh-client-ui-customize'
```

- **Skills**: each card shows the skill's license and whether it is installed. A skill installed by hand shows as *Installed separately* and is left alone.
- **Connectors**: **Connect** opens the service's sign-in page in a new browser window; a connector that is added but not signed in offers **Sign in** again. **Add a connector by address** takes a name and an MCP address.
- **MCP servers**: the switch turns a server on or off. A server that needs keys or folders shows fields for the ones still missing; **Save** stores them. **Add your own server** reads an `https` address as a remote server and anything else as a command line, keeping quoted words together.

Names become ids: lowercase letters, digits and dashes, starting with a letter, at most 32 characters.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin registers one `settings.section` contribution (id `customize`, order 12) and hands the component a face over `ctx.remote.customize`. The section reads the snapshot when it mounts, after each change it makes, and whenever the Host emits `customize/changed` or the connection resets. A refused call shows the Host's reason in an alert line with **Try again**. Typed key values stay in the component until **Save** and are cleared once stored; the Host never sends them back.

<a id="further-exploration"></a>
## Further Exploration

- [Customize gateway](../customize/README.md): the Remote this page calls.
- [MCP directory](../../mcp/mcp-directory/README.md): the catalog behind the three pages.

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings page that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **English only**: the section ships an English dictionary; a language pack can add others.
- **No search**: the three lists are short and are shown whole.
