// @ts-check
/**
 * Hack Dev Code for VS Code. Every command runs the Hack Dev Code CLI on the open workspace: tasks go to
 * `hackdev headless -` on standard input (no shell quoting of the text), the answer streams into the
 * "Hack Dev Code" output panel, and the full app runs as `hackdev web` inside VS Code's Simple Browser.
 */

const vscode = require('vscode')
const { spawn } = require('node:child_process')
const { relative } = require('node:path')

/** @type {vscode.OutputChannel | undefined} */
let output
/** @type {import('node:child_process').ChildProcess | undefined} */
let running
/** @type {import('node:child_process').ChildProcess | undefined} */
let webServer

/** @returns {vscode.OutputChannel} */
function channel() {
  output ??= vscode.window.createOutputChannel('Hack Dev Code')
  return output
}

/** @returns {vscode.WorkspaceConfiguration} */
function settings() {
  return vscode.workspace.getConfiguration('hackdev')
}

/**
 * The folder tasks run in: the one holding the active file, else the first workspace folder.
 * @returns {string | undefined}
 */
function workspaceRoot() {
  const active = vscode.window.activeTextEditor?.document.uri
  const folder = (active === undefined ? undefined : vscode.workspace.getWorkspaceFolder(active)) ?? vscode.workspace.workspaceFolders?.[0]
  return folder?.uri.fsPath
}

/**
 * Start the CLI with extra arguments. The configured command may carry its own arguments, so it runs through the
 * platform shell; the extra arguments are fixed words, never user text.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {import('node:child_process').ChildProcess}
 */
function startCli(args, cwd) {
  const command = String(settings().get('command') ?? 'hackdev').trim() || 'hackdev'
  return spawn(`${command} ${args.join(' ')}`, { cwd, shell: true, windowsHide: true, env: process.env })
}

/**
 * Run one headless task and stream its answer.
 * @param {string} task - the task text.
 * @param {{ title: string, readOnly?: boolean }} options
 * @returns {Promise<string>} the answer.
 */
function runTask(task, options) {
  const cwd = workspaceRoot()
  if (cwd === undefined) {
    void vscode.window.showErrorMessage('Open a folder first: Hack Dev Code works on a workspace.')
    return Promise.resolve('')
  }
  if (running !== undefined) {
    void vscode.window.showWarningMessage('A Hack Dev Code task is already running. Stop it first with "Hack Dev Code: Stop the Running Task".')
    return Promise.resolve('')
  }
  const mode = options.readOnly === true ? 'read-only' : String(settings().get('permissionMode') ?? '')
  const args = ['headless', ...mode === '' ? [] : ['--permission-mode', mode, ...options.readOnly === true ? ['--approval-policy', 'never'] : []], '-']
  const out = channel()
  out.show(true)
  out.appendLine(`\n── ${options.title} · ${new Date().toLocaleTimeString()} ──`)
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Hack Dev Code: ${options.title}` }, () => new Promise((resolve) => {
    const child = startCli(args, cwd)
    running = child
    let answer = ''
    child.stdout?.setEncoding('utf8').on('data', (chunk) => { answer += chunk; out.append(chunk) })
    // Diagnostics and reasoning arrive on stderr; they help follow the work.
    child.stderr?.setEncoding('utf8').on('data', (chunk) => { out.append(chunk) })
    child.on('error', (error) => {
      out.appendLine(`\nCould not start Hack Dev Code: ${error.message}. Set "hackdev.command" in the settings.`)
    })
    child.on('close', (code) => {
      running = undefined
      if (code !== 0 && code !== null) {
        out.appendLine(`\nHack Dev Code exited with code ${String(code)}.`)
        void vscode.window.showErrorMessage('Hack Dev Code stopped with an error; see the Hack Dev Code output panel.', 'Settings')
          .then((choice) => { if (choice === 'Settings') void vscode.commands.executeCommand('workbench.action.openSettings', 'hackdev') })
      }
      resolve(answer)
    })
    child.stdin?.end(task)
  }))
}

/** Ask a free-form task about the workspace. */
async function ask() {
  const task = await vscode.window.showInputBox({ title: 'Ask Hack Dev Code', prompt: 'What should Hack Dev Code do in this workspace?', ignoreFocusOut: true })
  if (task === undefined || task.trim() === '') return
  await runTask(task, { title: task.length > 50 ? `${task.slice(0, 50)}…` : task })
}

/** Ask about the selected code, with its file and lines. */
async function askAboutSelection() {
  const editor = vscode.window.activeTextEditor
  if (editor === undefined || editor.selection.isEmpty) {
    void vscode.window.showInformationMessage('Select some code first.')
    return
  }
  const instruction = await vscode.window.showInputBox({
    title: 'Ask about the selection', prompt: 'For example: explain this, find the bug, add tests, refactor for readability', ignoreFocusOut: true,
  })
  if (instruction === undefined || instruction.trim() === '') return
  const root = workspaceRoot()
  const file = root === undefined ? editor.document.uri.fsPath : relative(root, editor.document.uri.fsPath)
  const start = editor.selection.start.line + 1
  const end = editor.selection.end.line + 1
  const code = editor.document.getText(editor.selection)
  const task = `${instruction}\n\nThis is about ${file}, lines ${String(start)} to ${String(end)} (${editor.document.languageId}):\n\`\`\`\n${code}\n\`\`\``
  await runTask(task, { title: `${instruction.slice(0, 40)} · ${file}:${String(start)}` })
}

/** Review the uncommitted and branch changes read-only and open the review as Markdown. */
async function reviewChanges() {
  const extra = String(settings().get('reviewInstructions') ?? '')
  const task = 'Review my changes in this repository: the uncommitted changes (git diff HEAD) and, when this branch differs from its upstream '
    + 'or main branch, the commits on it. Read the changed files and the code they call where you need context. Do not change any file. '
    + 'Report only real problems: bugs, security issues, data loss, broken error handling, and missing or wrong tests for changed behaviour. '
    + 'For each give the file and line, the severity, what goes wrong in a concrete case, and the fix; check each against the code first. '
    + 'Write Markdown: a one-line verdict, then the findings by severity, or "No blocking issues found."'
    + (extra.trim() === '' ? '' : `\n${extra}`)
  const review = await runTask(task, { title: 'Review my changes', readOnly: true })
  if (review.trim() === '') return
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: `# Hack Dev Code review\n\n${review}` })
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside })
}

/** Start the full app for this workspace and show it inside VS Code. */
async function openHere() {
  const cwd = workspaceRoot()
  if (cwd === undefined) {
    void vscode.window.showErrorMessage('Open a folder first: Hack Dev Code works on a workspace.')
    return
  }
  const out = channel()
  if (webServer !== undefined) webServer.kill()
  const child = startCli(['web'], cwd)
  webServer = child
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Starting Hack Dev Code…' }, () => new Promise((resolve) => {
    let shown = false
    const timer = setTimeout(() => {
      if (!shown) void vscode.window.showErrorMessage('Hack Dev Code did not start within a minute; see the Hack Dev Code output panel.')
      resolve(undefined)
    }, 60_000)
    /** @param {string} chunk */
    const watch = (chunk) => {
      out.append(chunk)
      const url = /https?:\/\/127\.0\.0\.1:\d+\/\S*/u.exec(chunk)?.[0]
      if (url !== undefined && !shown) {
        shown = true
        clearTimeout(timer)
        void vscode.commands.executeCommand('simpleBrowser.show', url)
        resolve(undefined)
      }
    }
    child.stdout?.setEncoding('utf8').on('data', watch)
    child.stderr?.setEncoding('utf8').on('data', watch)
    child.on('error', (error) => { out.appendLine(`Could not start Hack Dev Code: ${error.message}`); clearTimeout(timer); resolve(undefined) })
    child.on('close', () => { if (webServer === child) webServer = undefined; clearTimeout(timer); resolve(undefined) })
  }))
}

/** Bring up the desktop app through its link scheme. */
async function openDesktop() {
  const opened = await vscode.env.openExternal(vscode.Uri.parse('hackdevcode://open'))
  if (!opened) void vscode.window.showErrorMessage('The Hack Dev Code desktop app is not installed or did not open.')
}

/** Stop the running task. */
function stop() {
  if (running === undefined) {
    void vscode.window.showInformationMessage('No Hack Dev Code task is running.')
    return
  }
  running.kill()
  channel().appendLine('\nStopped.')
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('hackdev.ask', ask),
    vscode.commands.registerCommand('hackdev.askAboutSelection', askAboutSelection),
    vscode.commands.registerCommand('hackdev.reviewChanges', reviewChanges),
    vscode.commands.registerCommand('hackdev.openHere', openHere),
    vscode.commands.registerCommand('hackdev.openDesktop', openDesktop),
    vscode.commands.registerCommand('hackdev.stop', stop),
    { dispose() { running?.kill(); webServer?.kill(); output?.dispose() } },
  )
}

function deactivate() {
  running?.kill()
  webServer?.kill()
}

module.exports = { activate, deactivate }
