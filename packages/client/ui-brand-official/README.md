---
description: "Official Hack Dev Code sidebar branding."
kind: "package-reference"
---

# @hackdevcode/dsh-client-ui-brand-official

## Summary

This package gives an `official` client build the Hack Dev Code sidebar artwork. The shipped Web and Desktop compositions load it by default. Other build profiles retain their existing branding. The hero mark stays on its fallback, and the blank home has no background decoration. It adds no model requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shipped Web and Desktop compositions already mount this plugin; an `official` client build registers the Hack Dev Code sidebar artwork.

### Choosing the profile

`DSH_CLIENT_BUILD_PROFILE` selects which brand renders. An `official` build shows the official sidebar mark and name; any other value leaves the shell fallbacks — the fish mark and the local-build label — in place. The conversation hero shows the animated hero fish from `dsh-client-ui-conversation` regardless of profile, because that fallback is already the official mark. The plugin still loads and validates in both cases; only the sidebar artwork registration is profile-gated.

The artwork values are fixed and the row takes no configuration. This is built-in presentation, without a separately installed bundle or Plugins-page toggle.

### Replacing the brand

A deployment with its own identity leaves this package out and composes another package that occupies the sidebar slots — and, for a decoration, the `conversation.hero.frame` layer and the hero-mark slot, which this package leaves empty and on its fallback. Occupying a slot is the only composition route; the artwork identity is not configurable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The two occupants install as one declaration-aware registration set: nested `ctx.slots.inject()` calls wait on the sidebar declaration, so the set works whether this row activates before or after the declarer, withdraws both occupants when the declaration collapses, and leaves no partial brand mix during HMR. The browser half is [`src/client/index.ts`](src/client/index.ts); the node half is an empty Loader seat. The browser title is a build-environment concern (`DSH_CLIENT_TITLE`), outside the slot system.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the brand surface is not enough. They move from the slots this package occupies to the shell that renders them.

- [ui-sidebar](../ui-sidebar/README.md) — declares `sidebar.brand.mark` and `sidebar.brand.name` and renders their fallbacks.
- [ui-conversation](../ui-conversation/README.md) — declares `conversation.hero.brand.mark` in the hero and the `conversation.hero.frame` layer another package may occupy.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how brand presentation is supplied. They are current package constraints, not a brand-design comparison or a task backlog.

- **One occupant set** — alternative presentation belongs in another Cordis package occupying the same slots.
- **The browser title is independent** — `DSH_CLIENT_TITLE` selects title text at build time rather than through a UI slot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
