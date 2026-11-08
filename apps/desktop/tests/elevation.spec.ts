import { describe, expect, it } from 'vitest'
import { ELEVATION_ATTEMPT_ARG, isElevated, relaunchScript, requestStartupElevation } from '../src/elevation.ts'
import type { ElevationRequest, SyncRunner } from '../src/elevation.ts'

const base: ElevationRequest = {
  platform: 'win32', packaged: true, argv: ['C:\\Apps\\Hack Dev Code\\Hack Dev Code.exe'], env: {},
  execPath: 'C:\\Apps\\Hack Dev Code\\Hack Dev Code.exe', cwd: 'C:\\Users\\me',
}

/** A runner where `net session` succeeds only when elevated, and PowerShell answers with `answer`. */
function runner(elevated: boolean, answer = 'STARTED'): { run: SyncRunner; calls: string[] } {
  const calls: string[] = []
  const run: SyncRunner = (file) => {
    calls.push(file)
    if (file === 'net') {
      if (!elevated) throw new Error('access denied')
      return ''
    }
    return `${answer}\r\n`
  }
  return { run, calls }
}

describe('administrator rights at startup', () => {
  it('relaunches a packaged, unelevated Windows app once, through the UAC prompt', () => {
    const { run, calls } = runner(false)
    expect(requestStartupElevation(base, run)).toBe('relaunched')
    expect(calls).toEqual(['net', 'powershell.exe'])
  })

  it('keeps running when the person declines, and never asks again from the elevated copy', () => {
    expect(requestStartupElevation(base, runner(false, 'DECLINED').run)).toBe('declined')
    const retried = runner(false)
    expect(requestStartupElevation({ ...base, argv: [...base.argv, ELEVATION_ATTEMPT_ARG] }, retried.run)).toBe('not-needed')
    expect(retried.calls).toEqual(['net'])
    expect(requestStartupElevation({ ...base, argv: [...base.argv, ELEVATION_ATTEMPT_ARG] }, runner(true).run)).toBe('elevated')
  })

  it('does nothing when already elevated, unpackaged, off Windows, or turned off', () => {
    expect(requestStartupElevation(base, runner(true).run)).toBe('elevated')
    for (const request of [
      { ...base, packaged: false }, { ...base, platform: 'linux' as const },
      { ...base, env: { HACKDEV_RUN_AS_ADMIN: '0' } }, { ...base, argv: [...base.argv, '--no-admin'] },
    ]) {
      const { run, calls } = runner(false)
      expect(requestStartupElevation(request, run)).toBe('not-needed')
      expect(calls).toEqual([])
    }
    expect(requestStartupElevation(base, () => { throw new Error('PowerShell missing') })).toBe('failed')
  })

  it('quotes paths and arguments for the elevated start, curly quotes included', () => {
    const script = relaunchScript('C:\\Apps\\Hack Dev Code\\app.exe', ['--open', 'C:\\My Files\\it\u2019s.txt'], 'C:\\Users\\me')
    expect(script).toContain("-FilePath 'C:\\Apps\\Hack Dev Code\\app.exe' -ArgumentList @('--open', '\"C:\\My Files\\it\u2019\u2019s.txt\"')")
    expect(script).toContain('-Verb RunAs')
    expect(script).toContain('NativeErrorCode -eq 1223')
  })

  it.runIf(process.platform === 'win32')('reads this process\'s elevation from Windows', () => {
    expect(typeof isElevated()).toBe('boolean')
  })
})
