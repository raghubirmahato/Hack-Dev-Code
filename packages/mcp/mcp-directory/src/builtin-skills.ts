/**
 * Skills that ship inside Hack Dev Code: they are available in every session with nothing to download or install.
 * A skill of the same name in the person's own or the project's skill folder takes precedence over a built-in one.
 * @module @hackdevcode/dsh-mcp-directory/builtin-skills
 */

/** One built-in skill. */
export interface BuiltinSkill {
  /** Kebab-case name the skill is loaded by. */
  name: string
  /** Name shown on the settings page. */
  title: string
  /** When to use it, for the person and the model. */
  description: string
  /** The instructions, as Markdown. */
  content: string
}

/** The built-in skills, in display order. */
export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  {
    name: 'code-review',
    title: 'Code review',
    description: 'Review a diff, branch or pull request for correctness bugs, risky changes and missing tests, and report findings ranked by severity.',
    content: `# Code review

Review the change the person points at (the working tree diff when they name nothing) and report what would go wrong, not what you would have written differently.

## Method

1. Establish the change: \`git status\`, then \`git diff\` (or \`git diff <base>...HEAD\` for a branch). Read every changed hunk; open the surrounding file when a hunk depends on code outside it.
2. Understand the intent from the commit messages, the task, and the tests that changed. A change is judged against what it is meant to do.
3. For each hunk ask: what input, state or ordering makes this wrong? Check error and empty paths, off-by-one and boundary values, null and undefined, concurrency and re-entrancy, resource cleanup, and callers that rely on the old behaviour (search for them).
4. Check the seams: changed function signatures, config keys, schemas, routes and file formats must be updated at every use, in tests and in docs.
5. Run what proves or disproves a suspicion: the test suite, the type checker, the linter, or a short script. A finding you reproduced is worth more than three you guessed.
6. Look for what is missing: a test for the new behaviour, a migration, an entry in the changelog or README.

## Report

Lead with the verdict in one sentence. Then list findings most severe first, each with the file and line, the concrete failing scenario (inputs and the wrong result), and the smallest fix. Separate confirmed defects from concerns you could not verify, and say which checks you ran with their outcome. Leave out style preferences the project's linter does not enforce.`,
  },
  {
    name: 'systematic-debugging',
    title: 'Systematic debugging',
    description: 'Find the root cause of a bug, failing test or unexpected behaviour by reproducing it, narrowing it down and proving the fix, instead of guessing.',
    content: `# Systematic debugging

Fix the cause, not the symptom. Do not change code until you can say why it fails.

## Method

1. Reproduce it. Get the exact command, input and environment that fail, and the full error with its stack trace. If it fails only sometimes, find what varies (order, timing, data, machine) and loop the command until it fails.
2. Read the error literally. Open the file and line it names. Most bugs are where the message says they are.
3. Find the last point where the state is right and the first point where it is wrong. Narrow the gap by reading the code between them, adding temporary logging, or bisecting (\`git bisect\` when it used to work).
4. State one hypothesis that explains every observed fact, including the ones that seem unrelated. Predict something it implies that you have not looked at yet, and check it. If the prediction fails, discard the hypothesis rather than stretching it.
5. Make the smallest change that removes the cause. Then run the reproduction again and the surrounding tests.
6. Add a test that fails without the fix and passes with it. Remove the temporary logging.

## Rules

- Change one thing at a time; revert an attempt that did not help before trying the next.
- A fix you cannot explain is not a fix. "It works now" after several changes means you no longer know which one mattered.
- When three attempts have failed, stop and question the assumption they share: the wrong file, a stale build, a cache, a different process, or a version that is not the one you think is running.
- Report the cause, the fix, and how you verified it. Say plainly when you could not reproduce the problem.`,
  },
  {
    name: 'test-first',
    title: 'Test-first development',
    description: 'Build a feature or fix a bug test-first: write a failing test that states the behaviour, make it pass with the simplest code, then tidy up.',
    content: `# Test-first development

Use this when the person asks for a feature or a fix in code that has, or should have, automated tests.

## Loop

1. Learn the project's test setup before writing anything: the framework, where tests live, how one test is run, and how existing tests are named and structured. Match it.
2. Write one test for the next small piece of behaviour. Name it after the behaviour ("rejects an expired token"), not the function. Assert on observable results, not on internals.
3. Run it and watch it fail for the right reason. A test that passes before the code exists, or fails with an import error, proves nothing yet.
4. Write the simplest code that makes it pass. Run the test, then the whole file.
5. Tidy up with the tests green: remove duplication, improve names, keep the behaviour. Run the tests again.
6. Repeat for the next behaviour: the error path, the empty input, the boundary value.

## What a good test looks like

- Deterministic: no real network, clock, random numbers or shared files. Inject them or use the framework's fakes.
- One reason to fail, and a failure message that says what is wrong.
- Tests the contract a caller relies on, so it survives a rewrite of the implementation.

## For a bug

Start with a test that reproduces the bug and fails. Fix the code. The test stays as the regression guard.

Finish by running the full suite, the type checker and the linter, and report the commands with their results.`,
  },
  {
    name: 'git-commit-and-pr',
    title: 'Commits and pull requests',
    description: 'Turn finished work into clean commits and a pull request: review the diff, write messages that explain why, and open a PR a reviewer can act on.',
    content: `# Commits and pull requests

Commit or push only when the person asked for it. Never commit secrets, generated build output or unrelated changes.

## Before committing

1. \`git status\` and \`git diff\` (plus \`git diff --staged\`): read everything that would go in. Leave out debug code, stray files and changes that belong to a different task.
2. Run the project's checks (tests, type check, lint). Do not commit a tree you know is broken, and never skip hooks to get a commit through; fix what the hook reports.
3. If you are on the default branch and the work is more than a trivial fix, create a branch first.

## The commit

- One logical change per commit. Stage by path, or \`git add -p\`, to split unrelated work.
- Read \`git log --oneline -15\` and follow the project's message style (prefixes, tense, length).
- Subject: what changed, imperative, about 50 characters, no trailing period. Body: why it changed and anything a future reader needs (the constraint, the rejected alternative, the issue number). The diff already says how.
- Prefer a new commit to amending one that was pushed. Never force-push a shared branch.

## The pull request

- Push the branch (\`git push -u origin <branch>\`), then open the PR with the project's tool (\`gh pr create\`).
- Title: the change in one line. Description: the problem, the approach, how it was tested (the commands and results), what a reviewer should look at first, and anything deliberately left out.
- Link the issue it closes. Add screenshots for a visible change.
- After opening it, report the PR link and the state of its checks.`,
  },
  {
    name: 'security-review',
    title: 'Security review',
    description: 'Audit code or a change for security weaknesses (injection, broken access control, secrets, unsafe file and network handling) and fix or report each with evidence.',
    content: `# Security review

Review the code the person points at for weaknesses an attacker could use. Be concrete: a finding names the entry point, the path the data takes and what an attacker gains.

## Method

1. Map the surface: entry points (routes, CLI arguments, files read, messages consumed, webhooks), where authentication and authorization happen, what is stored, and which external services are called.
2. Follow untrusted data from each entry point to where it is used. Look for:
   - Injection: SQL and NoSQL queries built from strings, shell commands, template rendering, \`eval\`, dynamic imports, regular expressions built from input.
   - Output handling: HTML built without escaping, unsafe DOM writes, open redirects, header injection.
   - Access control: a check that is missing on one route, an object fetched by id without checking its owner, a role taken from the request.
   - Files and network: path traversal, archive extraction outside the target folder, requests to addresses the user controls, unvalidated uploads.
   - Secrets: keys in source, logs, error messages, URLs or the repository history; weak or missing password hashing; tokens that never expire.
   - Session and browser: cookies without HttpOnly, Secure and SameSite; missing CSRF protection on state-changing requests; permissive CORS.
   - Dependencies and defaults: run the ecosystem's audit command; check for debug modes, default credentials and verbose errors left on.
3. Confirm what you can: write the request or input that triggers the weakness and observe the result in a test or a local run. Never test against a system the person does not own.
4. Fix with the smallest change that closes the hole: parameterised queries, escaping at the output, an ownership check, an allow-list, a secure default. Add a regression test for each fix.

## Report

List findings by severity with file and line, the attack in one or two sentences, the fix you made or recommend, and how you verified it. State what you did not review. Never claim code is secure; say what you checked and what risk remains.`,
  },
  {
    name: 'web-research',
    title: 'Web research',
    description: 'Answer a question that needs current or sourced information: search, read primary sources, cross-check claims and report with links and stated confidence.',
    content: `# Web research

Use this when the answer depends on facts you may not have or that change: versions, prices, APIs, events, comparisons.

## Method

1. Restate the question as the specific things you need to find out. Decide what a good answer contains before searching.
2. Search with several differently worded queries rather than one. Include the year for anything recent, and the exact error text, version or product name when there is one.
3. Open the sources. A search snippet is not evidence. Prefer primary sources: official documentation, the source repository, the standard, the vendor's own announcement, the paper. Use secondary write-ups to find primary ones.
4. Check the date and the version each page is about. Discard pages about a different version than the person uses.
5. Cross-check every claim that matters against a second independent source. When sources disagree, say so and say which you trust and why.
6. For a library or API, confirm against the installed version when the project is at hand: the lockfile, the package's own files, or \`--help\`.

## Report

Answer the question first, then give the supporting facts, each with its link. Mark what is confirmed by a primary source, what rests on a single source, and what you could not verify. Quote sparingly and never invent a link, a version number or a quotation.`,
  },
]

/** Provider name the built-in skills are registered under. */
export const BUILTIN_SKILL_PROVIDER = 'hackdev-builtin'
