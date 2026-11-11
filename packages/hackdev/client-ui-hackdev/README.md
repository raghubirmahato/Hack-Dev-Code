---
description: "Web card for Hack Dev Code missions and gate reviews: tasks, gate verdicts, issues and items needing human approval."
kind: "package-reference"
---

# @hackdevcode/dsh-client-ui-hackdev

## Summary

The tool card that shows a `hackdev` mission or `hackdev_review` run in the conversation: header counts, each task with its state, each gate's verdict and findings, and the items that need a person's attention first.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The Web app bundle mounts the card; it renders for calls of the two mission tools and falls back to the generic tool card for anything it cannot read.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [src/client/HackDevCard.tsx](src/client/HackDevCard.tsx) | The card: header counts, attention items (six shown, the rest behind a toggle), tasks and gates |
| [src/client/model.ts](src/client/model.ts) | Reads the mission arguments and the result's presentation data into the view the card draws |
| [src/client/mount.ts](src/client/mount.ts) | Registers the card for the two tools |
| [src/client/locales.ts](src/client/locales.ts) | Card copy |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Mission tools](../tool-hackdev/README.md) — what the pipeline returns.
- [Design and operations](../../../docs/hack-dev-code.md) — the phases the card summarizes.

<a id="model-experience"></a>
## Model Experience

None, as the card only presents a tool result the model already received.

#### KV Cache effect

None; rendering does not modify model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Read-only** — the card shows items needing approval but does not act on them; the person answers in the conversation.
