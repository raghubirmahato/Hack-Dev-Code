/** Asterisk strong emphasis in a settled CJK reply opens after CJK text when the span starts with punctuation. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/markdown-cjk-strong-open', import.meta.url))
const MODE = webSnapshotMode()
const STRONG_TEXTS = [
  '“\u5f53\u952e\u76d8\u5df2\u7ecf\u8fdb\u5165\u6df1\u7761\u7720\uff08\u5f7b\u5e95\u65ad\u8fde\uff09\u65f6\u7684\u91cd\u8fde\u901f\u5ea6”',
  '“Wi-Fi \u4e0b\u6536\u4e0d\u5230\u63a8\u9001”',
  '\uff08\u5185\u5bb9\uff09',
  '\u300c\u6df1\u7761\u7720\u300d',
  '“\u914d\u5bf9\u6d41\u7a0b”',
]

describe('web e2e: strong emphasis opening after CJK text', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(join(SNAPSHOT_DIR, 'session.v4.jsonl'), 'utf8'), 'markdown-cjk-strong-open')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.locator('[role="treeitem"]').first().click()
    await page.locator('[role="treeitem"]').nth(1).click()
    await page.locator('[class*="markdown"] p', { hasText: '\u672c\u8eab\u3002' }).first().waitFor()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders each punctuation-led span after CJK text as strong and leaves no bare markers', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-cjk-strong-open'))
    const reply = page.locator('[class*="markdown"]', { has: page.locator('p', { hasText: '\u672c\u8eab\u3002' }) }).first()
    expect(await reply.locator('strong').allTextContents()).toEqual(STRONG_TEXTS)
    expect(await reply.textContent()).not.toContain('**')
    const prose = await reply.ariaSnapshot()
    await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'reply.expected.md'), prose, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v4.jsonl', 'reply.expected.md'])
  })
})
