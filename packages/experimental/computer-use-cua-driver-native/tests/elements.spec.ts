import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@hackdevcode/cordis'
import { executeToolFixture } from '@hackdevcode/dsh-tool-testkit'
import * as NativeToolExecutor from '@hackdevcode/dsh-tool-executor-native'
import ToolRuntime from '@hackdevcode/dsh-tools'
import SystemPrompt from '@hackdevcode/dsh-system-prompt'
import { ToolCallId } from '@hackdevcode/dsh-llm'
import {
  findOcrLine, formatOcr, launchScript, ocrScript, psQuote, parseOcrLines, parseTesseractTsv, registerDisplayTools, selectWindow,
  waitForText,
} from '../src/displays.ts'
import type { DisplayBackend, ElementPatternAction, OcrLine, WindowInfo } from '../src/displays.ts'
import { opCommand, opScript } from '../src/elevated.ts'

/** A one-pixel PNG. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

/** A Save dialog with a few controls, a canvas window with only on-screen text, and a record of every action. */
function fakeDesktop(options: { find?: string; act?: string } = {}): { backend: DisplayBackend; actions: string[] } {
  const actions: string[] = []
  const windows: WindowInfo[] = [
    { handle: 10, pid: 1, process: 'notepad', title: 'Save As', x: 100, y: 100, width: 800, height: 500, minimized: false, foreground: true },
    { handle: 20, pid: 2, process: 'game', title: 'Canvas', x: 1000, y: 0, width: 600, height: 400, minimized: false, foreground: false },
  ]
  const front = (handle: number): void => { for (const window of windows) window.foreground = window.handle === handle }
  const screenText: OcrLine[] = [{ text: 'Start game', x: 1100, y: 100, width: 120, height: 20 }, { text: 'Options', x: 1100, y: 140, width: 80, height: 20 }]
  const backend: DisplayBackend = {
    list: async () => [{ index: 0, name: 'main', primary: true, x: 0, y: 0, width: 1920, height: 1080 }],
    capture: async (path, area) => {
      actions.push(`capture ${area === undefined ? 'all' : `${String(area.x)},${String(area.y)}`}`)
      await writeFile(path, PIXEL)
      return { width: 960, height: 540, scale: 0.5 }
    },
    pointer: async (x, y, button, count) => { actions.push(`pointer ${String(x)},${String(y)} ${button} x${String(count)}`) },
    drag: async () => {},
    scroll: async () => {},
    keys: async (chords) => { actions.push(`keys ${chords.map(chord => chord.names.join('+')).join(' ')}`) },
    type: async (text) => { actions.push(`type ${text}`) },
    windows: async () => windows.map(window => ({ ...window })),
    window: async (handle, action) => { actions.push(`${action} ${String(handle)}`); if (action === 'focus') front(handle) },
    open: async () => {},
    readText: async handle => handle === 10 ? '[1] Window "Save As"\n  [2] Edit "File name" @(300,400)\n  [3] Button "Save" @(700,560)\n' : '',
    pressButton: async (x, y, which, down) => { actions.push(`${down ? 'press' : 'release'} ${which} ${String(x)},${String(y)}`) },
    holdKeys: async (chord, down) => { actions.push(`${down ? 'hold' : 'release'} ${chord.names.join('+')}`) },
    place: async () => {},
    launch: async app => `Started ${app}`,
    findElements: async (handle, query) => {
      actions.push(`find ${String(handle)} ${JSON.stringify(query)}`)
      if (options.find !== undefined) return options.find
      if (handle !== 10) return ''
      if (query.name === 'Save') return '=[3] Button "Save" @(700,560)\n~[4] Button "Save as type" @(300,450)\n'
      if (query.name === 'File name') return '=[2] Edit "File name" @(300,400)\n'
      return ''
    },
    elementAction: async (handle, index, action: ElementPatternAction, value) => {
      actions.push(`act ${String(handle)} [${String(index)}] ${action}${value === undefined ? '' : ` ${value}`}`)
      return options.act ?? 'Button "Save" @(700,560)'
    },
    elementPoint: async (_handle, index) => index === 3 ? { x: 700, y: 560 } : { x: 300, y: 400 },
    ocr: async (area) => { actions.push(`ocr ${String(area.x)},${String(area.y)}`); return area.x === 1000 ? screenText : [] },
    close: () => {},
  }
  return { backend, actions }
}

let ctx: Context

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

async function mount(backend: DisplayBackend): Promise<void> {
  await ctx.plugin({ inject: ['tools'], apply: (inner: Context) => { registerDisplayTools(inner, backend) } })
}

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await executeToolFixture(ctx, { name, callId: ToolCallId('element-test'), arguments: args, signal: new AbortController().signal })
  return { isError: result.isError, text: JSON.stringify(result.content) }
}

describe('desktop_element', () => {
  it('clicks the exact name match among partial ones, at the point the app reports', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_element', { action: 'click', name: 'Save' })
    expect(result.isError).toBe(false)
    expect(result.text).toContain('click on [3] at (700, 560) in \\"Save As\\"')
    expect(actions).toEqual(['find 10 {"name":"Save"}', 'pointer 700,560 left x1'])
  })

  it('lists matches for find without the match markers', async () => {
    const { backend } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_element', { action: 'find', name: 'Save', title: 'Save As' })
    expect(result.text).toContain('[3] Button \\"Save\\" @(700,560)\\n[4] Button \\"Save as type\\"')
    expect(result.text).not.toContain('=[3]')
  })

  it('asks for an index when several controls match equally', async () => {
    const { backend } = fakeDesktop({ find: '~[5] Button "Open" @(1,1)\n~[6] Button "Open recent" @(2,2)\n' })
    await mount(backend)
    const result = await call('desktop_element', { action: 'invoke', name: 'Op' })
    expect(result.isError).toBe(true)
    expect(result.text).toContain('2 controls match; pass index')
  })

  it('operates a control through its pattern and reports its state afterwards', async () => {
    const { backend, actions } = fakeDesktop({ act: 'Edit "File name" = "report.txt" @(300,400) (focused)' })
    await mount(backend)
    const result = await call('desktop_element', { action: 'set_value', name: 'File name', value: 'report.txt' })
    expect(result.text).toContain('set_value [2] done; now Edit \\"File name\\" = \\"report.txt\\"')
    expect(actions).toContain('act 10 [2] set_value report.txt')
  })

  it('falls back to a real click, or to click, select all and type, when the control has no such pattern', async () => {
    const click = fakeDesktop({ act: 'CLICK 700 560' })
    await mount(click.backend)
    expect((await call('desktop_element', { action: 'toggle', index: 3 })).text).toContain('does not support toggle, so it was clicked at (700, 560)')
    expect(click.actions).toEqual(['act 10 [3] toggle', 'pointer 700,560 left x1'])
    await ctx.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    const type = fakeDesktop({ act: 'TYPE 300 400' })
    await mount(type.backend)
    expect((await call('desktop_element', { action: 'set_value', index: 2, value: 'a.txt' })).isError).toBe(false)
    expect(type.actions).toEqual(['act 10 [2] set_value a.txt', 'pointer 300,400 left x1', 'keys ctrl+a', 'type a.txt'])
  })

  it('clicks text recognized on screen when a window exposes no matching control', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_element', { action: 'click', name: 'start game', title: 'Canvas' })
    expect(result.isError).toBe(false)
    expect(result.text).toContain('the text \\"Start game\\" recognized on screen was clicked at (1160, 110)')
    // The window comes to the front before its screen text is read and clicked.
    expect(actions).toEqual(['find 20 {"name":"start game"}', 'focus 20', 'ocr 1000,0', 'pointer 1160,110 left x1'])
  })

  it('needs an index or a query, and value for set_value', async () => {
    const { backend } = fakeDesktop()
    await mount(backend)
    expect((await call('desktop_element', { action: 'click' })).text).toContain('pass index')
    expect((await call('desktop_element', { action: 'set_value', index: 2 })).text).toContain('set_value needs value')
    expect((await call('desktop_element', { action: 'teleport', index: 2 })).text).toContain('action must be one of')
  })
})

describe('reading the screen', () => {
  it('adds text recognized on screen when a window exposes few controls', async () => {
    const { backend } = fakeDesktop()
    await mount(backend)
    const result = await call('desktop_window', { action: 'read', title: 'Canvas' })
    expect(result.text).toContain('text recognized on screen')
    expect(result.text).toContain('[1] \\"Start game\\" @(1160,110)')
  })

  it('reads one window with desktop_ocr and maps screenshot points to the desktop', async () => {
    const { backend, actions } = fakeDesktop()
    await mount(backend)
    expect((await call('desktop_ocr', { title: 'Canvas' })).text).toContain('[2] \\"Options\\" @(1140,150)')
    await call('desktop_screenshot', { title: 'Save As' })
    expect((await call('desktop_pointer', { image_x: 100, image_y: 50 })).text).toContain('(300, 200)')
    expect((await call('desktop_pointer', { image_x: 5000, image_y: 50 })).text).toContain('outside the latest screenshot')
    expect((await call('desktop_pointer', {})).text).toContain('pass x and y')
    expect(actions).toContain('pointer 300,200 left x1')
  })

  it('waits until a window shows a text', async () => {
    let calls = 0
    const outcome = await waitForText(async () => { calls++; return calls < 3 ? 'Loading...' : 'Download   complete' }, 'download complete', false, 2000, undefined, 10)
    expect(outcome).toContain('Found the text')
    await expect(waitForText(async () => 'Loading...', 'Done', false, 500, undefined, 50)).rejects.toThrow('did not appear within 500 ms')
    expect(await waitForText(async () => 'idle', 'Loading', true, 500)).toContain('The text is gone')
  })

  it('formats, bounds and matches recognized lines', () => {
    const lines = [{ text: 'File', x: 0, y: 0, width: 20, height: 10 }, { text: 'File name:', x: 0, y: 50, width: 60, height: 10 }]
    expect(formatOcr(lines)).toBe('[1] "File" @(10,5)\n[2] "File name:" @(30,55)')
    expect(findOcrLine(lines, 'file')?.y).toBe(0)
    expect(findOcrLine(lines, 'name')?.y).toBe(50)
    expect(findOcrLine(lines, 'missing')).toBeUndefined()
    const many = Array.from({ length: 300 }, (_, index) => ({ text: `line ${String(index)}`, x: 0, y: index, width: 10, height: 1 }))
    expect(formatOcr(many)).toContain('... 50 more lines')
  })

  it('parses Windows OCR output and tesseract TSV into desktop lines', () => {
    expect(parseOcrLines('10\t20\t30\t8\tHello world\nbad line\n1\t2\t3\t4\t\n')).toEqual([{ text: 'Hello world', x: 10, y: 20, width: 30, height: 8 }])
    const tsv = [
      'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
      '5\t1\t1\t1\t1\t1\t10\t5\t30\t12\t96\tSave',
      '5\t1\t1\t1\t1\t2\t45\t6\t20\t11\t95\tfile',
      '5\t1\t1\t1\t2\t1\t10\t30\t40\t12\t90\tCancel',
      '4\t1\t1\t1\t2\t0\t10\t30\t40\t12\t-1\t',
    ].join('\n')
    expect(parseTesseractTsv(tsv, 100, 200)).toEqual([
      { text: 'Save file', x: 110, y: 205, width: 55, height: 12 },
      { text: 'Cancel', x: 110, y: 230, width: 40, height: 12 },
    ])
  })

  it('doubles every quote PowerShell ends a single-quoted string at, curly ones included', () => {
    expect(psQuote("it's")).toBe("'it''s'")
    expect(psQuote('don’t ‘x’')).toBe("'don’’t ‘‘x’’'")
    expect(psQuote('a‚b‛')).toBe("'a‚‚b‛‛'")
  })

  it('builds the OCR and launch scripts', () => {
    expect(ocrScript({ x: -10, y: 5, width: 800, height: 600 })).toContain('$s = 2; $bx = -10; $by = 5; $bw = 800; $bh = 600')
    expect(ocrScript({ x: 0, y: 0, width: 3840, height: 2160 })).toContain('$s = 1;')
    expect(ocrScript({ x: 0, y: 0, width: 10, height: 10 })).toContain("-replace '\\s+', ' '")
    const launch = launchScript(" Bob's App ")
    expect(launch).toContain("$q = 'Bob''s App'")
    expect(launch).toContain("Start-Process -FilePath ('shell:AppsFolder\\' + $m[0].AppID)")
  })
})

describe('launching apps and moving windows', () => {
  it('starts an app by name and reports the window it opened', async () => {
    const actions: string[] = []
    const windows: WindowInfo[] = []
    const { backend } = fakeDesktop()
    backend.windows = async () => windows.map(window => ({ ...window }))
    backend.launch = async (app) => {
      actions.push(`launch ${app}`)
      setTimeout(() => { windows.push({ handle: 4, pid: 4, process: 'CalculatorApp', title: 'Calculator', x: 0, y: 0, width: 400, height: 600, minimized: false, foreground: true }) }, 20)
      return `Started ${app} from the Start menu`
    }
    await mount(backend)
    const result = await call('desktop_open', { app: 'Calculator' })
    expect(result.text).toContain('Started Calculator from the Start menu. New window: handle 4 pid 4 CalculatorApp')
    expect(actions).toEqual(['launch Calculator'])
    expect((await call('desktop_open', {})).text).toContain('pass app')
  })

  it('moves a window, keeping what is not given, and says when the app kept another size', async () => {
    const { backend } = fakeDesktop()
    const placed: string[] = []
    backend.place = async (handle, x, y, width, height) => { placed.push(`${String(handle)} ${String(x)},${String(y)} ${String(width)}x${String(height)}`) }
    await mount(backend)
    const result = await call('desktop_window', { action: 'move', title: 'Save', x: 0, y: 0, width: 1200 })
    expect(placed).toEqual(['10 0,0 1200x500'])
    // The fake window keeps its size, as an app with a fixed size does.
    expect(result.text).toContain('The app kept 800x500 instead of 1200x500')
    expect((await call('desktop_window', { action: 'move', title: 'Save' })).text).toContain('move needs')
  })

  it('finds a window by process name and keeps errors short on a crowded desktop', () => {
    const many: WindowInfo[] = Array.from({ length: 20 }, (_, index) => ({
      handle: index + 1, pid: index, process: index === 7 ? 'Code.exe' : 'app', title: `Window ${String(index)}`, x: 0, y: 0, width: 10, height: 10, minimized: false, foreground: false,
    }))
    expect(selectWindow(many, undefined, 'code').handle).toBe(8)
    expect(() => selectWindow(many, undefined, 'nothing')).toThrow('... and 5 more; call desktop_window with action list')
  })

  it('moves windows through both input routes', () => {
    const op = { op: 'place', handle: 42, x: -10, y: 20, width: 800, height: 600 } as const
    expect(opScript(op)).toBe('[HackDev.Desk]::Place([IntPtr]42, -10, 20, 800, 600)')
    expect(opCommand(op)).toBe('place 42 -10 20 800 600')
  })
})
