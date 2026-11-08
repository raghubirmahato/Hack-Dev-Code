# Hack Dev Code for VS Code

Run Hack Dev Code agents on your workspace without leaving the editor. The extension drives the Hack Dev Code CLI, so it uses the models, keys, plugins and settings you already set up in Hack Dev Code, including DeepSeek, free and local models.

## Commands

| Command | Key | Does |
|---|---|---|
| Hack Dev Code: Ask… | `Ctrl+Alt+H` | Runs a task in the workspace ("add a health check endpoint", "why does the login test fail?") and streams the answer into the **Hack Dev Code** output panel. |
| Hack Dev Code: Ask About Selection… | `Ctrl+Alt+K`, or the editor context menu | Sends the selected code with its file and lines and your instruction: explain it, find the bug, add tests, refactor. |
| Hack Dev Code: Review My Changes | | Reviews your uncommitted changes and the commits on your branch in read-only mode and opens the review beside the editor. |
| Hack Dev Code: Open Hack Dev Code Here | | Starts the full app for this workspace (`hackdev web`) and shows it in VS Code's Simple Browser. |
| Hack Dev Code: Open the Desktop App | | Brings up the installed desktop app. |
| Hack Dev Code: Stop the Running Task | | Stops the task in progress. |

Tasks run with your Hack Dev Code permission defaults; set `hackdev.permissionMode` to `read-only` or `workspace-write` to limit what tasks started here may change. Reviews always run read-only.

## Settings

- `hackdev.command`: the command that starts the CLI. The desktop installer adds `hackdev`. From a source checkout, use `node --import tsx/esm "<checkout>/apps/cli/src/bin.ts"` (quote a path with spaces).
- `hackdev.permissionMode`: the permission preset for tasks: empty for your default, or `read-only`, `workspace-write`, `danger-full-access`.
- `hackdev.reviewInstructions`: extra review instructions, such as project conventions.

## Install

From this folder, package and install the extension:

```sh
npx @vscode/vsce package
code --install-extension hack-dev-code-0.2.2.vsix
```

## Known limitations

- One task runs at a time; its answer goes to the output panel, and file changes appear in the editor as the agent makes them.
- Inline completions while typing are not part of this extension.
