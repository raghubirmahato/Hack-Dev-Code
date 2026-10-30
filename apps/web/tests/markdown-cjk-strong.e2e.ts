import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@hackdevcode/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@hackdevcode/dsh-session'
import type {} from '@hackdevcode/dsh-session-title'
import {
  launchWebScaffold,
  seedSession,
  watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot, WEB_FIXTURE_TIME } from './support.ts'

const SEED_ID = 'markdown-cjk-strong-web-e2e'
const DONE = 'CJK_STRONG_DONE'
/** CJK cases stay escaped so the file is English, while rendering still exercises wide-character punctuation. */
const CASES = [
  ['**\u6ce8\u610f\uff1a**Content', '\u6ce8\u610f\uff1a', '\u6ce8\u610f\uff1a\u5185\u5bb9'],
  ['**Notice:**Content', 'Notice:', 'Notice:Content'],
  ['**\u4e8b\u4ef6\u4e2d\u95f4\u4ef6\uff08waterfall\uff09**\u5b9e\u73b0', '\u4e8b\u4ef6\u4e2d\u95f4\u4ef6\uff08waterfall\uff09', '\u4e8b\u4ef6\u4e2d\u95f4\u4ef6\uff08waterfall\uff09\u5b9e\u73b0'],
  ['**\u4e8b\u4ef6\u4e2d\u95f4\u4ef6(waterfall)**\u5b9e\u73b0', '\u4e8b\u4ef6\u4e2d\u95f4\u4ef6(waterfall)', '\u4e8b\u4ef6\u4e2d\u95f4\u4ef6(waterfall)\u5b9e\u73b0'],
  ['**\u53e5\u53f7\u3002**\u540e\u7eed', '\u53e5\u53f7\u3002', '\u53e5\u53f7\u3002\u540e\u7eed'],
  ['**Period.**\u540e\u7eed', 'Period.', 'Period.\u540e\u7eed'],
  ['**\u63d0\u9192\uff01**Continue', '\u63d0\u9192\uff01', '\u63d0\u9192\uff01\u7ee7\u7eed'],
  ['**Warning!**Continue', 'Warning!', 'Warning!Continue'],
] as const

/** Build one settled assistant reply covering CJK-adjacent strong punctuation boundaries. */
function markdownFixture(): string {
  const session = Session.create(SessionId('markdown-cjk-strong-source'))
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Render adjacent CJK strong emphasis.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'CJK strong emphasis',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    stream: [],
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{
        type: 'text',
        text: [
          '## CJK strong emphasis',
          '',
          ...CASES.flatMap(([markdown]) => [markdown, '']),
          DONE,
        ].join('\n'),
      }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({
      type: 'session',
      version: SESSION_FORMAT_VERSION,
      id: '{{sessionId}}',
      createdAt: 0,
      cwd: '{{cwd}}',
      isSeeded: false,
      delegationDepth: 0,
    }),
    ...session.snapshotEvents().map(event => JSON.stringify({
      ...event,
      time: WEB_FIXTURE_TIME + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: CJK-adjacent Markdown strong emphasis', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, markdownFixture(), SEED_ID, undefined, { createdAt: WEB_FIXTURE_TIME })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.clock.setFixedTime(WEB_FIXTURE_TIME)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders punctuation-terminated strong spans before adjacent CJK text', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-cjk-strong'))
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await expect.poll(() => page.getByText(DONE, { exact: true }).count(), { timeout: 15_000 }).toBe(1)

    const strong = page.locator('[class*="markdown"] strong')
    await expect.poll(() => strong.count(), { timeout: 10_000 }).toBe(CASES.length)
    expect(await strong.allTextContents()).toEqual(CASES.map(([, expected]) => expected))
    for (const [, , paragraph] of CASES) {
      expect(await page.getByText(paragraph, { exact: true }).count()).toBe(1)
    }
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)
})
