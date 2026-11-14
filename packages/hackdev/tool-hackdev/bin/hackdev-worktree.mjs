#!/usr/bin/env node
// Give a mission task its own git worktree holding the workspace as it stands now, uncommitted work included.
// Usage: node hackdev-worktree.mjs add <path>   (run in the workspace root)
// Prints one JSON line, {"created":true,"path":...} or {"created":false,"path":...,"reason":...}, and exits 0 either
// way, so the agent that runs it only has to report what it printed. It runs git directly, without a shell, so it
// behaves the same in PowerShell, cmd and POSIX shells.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const [command, path] = process.argv.slice(2)
const report = (created, reason) => {
  process.stdout.write(`${JSON.stringify(created ? { created, path } : { created, path, reason })}\n`)
}
const git = (args, input) => execFileSync('git', args, { encoding: 'buffer', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })

function add(target) {
  try {
    git(['rev-parse', '--verify', 'HEAD'])
  } catch {
    report(false, 'the workspace is not a git repository with at least one commit')
    return
  }
  const root = git(['rev-parse', '--show-toplevel']).toString().trim()
  const full = resolve(root, target)
  if (existsSync(full)) {
    report(false, `${target} already exists`)
    return
  }
  try {
    git(['worktree', 'add', '--detach', full, 'HEAD'])
    // Tracked changes, staged or not, as one binary patch applied inside the worktree.
    const patch = git(['diff', 'HEAD', '--binary'])
    if (patch.length > 0) git(['-C', full, 'apply', '--whitespace=nowarn', '-'], patch)
    // Untracked files that are not ignored, except the mission's own notes.
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean)
    for (const file of untracked) {
      if (file.startsWith('.hackdev/')) continue
      mkdirSync(dirname(join(full, file)), { recursive: true })
      copyFileSync(join(root, file), join(full, file))
    }
    report(true)
  } catch (error) {
    const detail = error instanceof Error && 'stderr' in error ? String(error.stderr).trim() : String(error)
    try { git(['worktree', 'remove', '--force', full]) } catch { rmSync(full, { recursive: true, force: true }) }
    report(false, detail.slice(0, 400) || 'git failed')
  }
}

if (command === 'add' && typeof path === 'string' && path.length > 0) add(path)
else report(false, 'usage: node hackdev-worktree.mjs add <path>')
