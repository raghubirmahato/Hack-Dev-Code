/**
 * Whole-desktop control with real input, beside the window-targeted Cua Driver tools: every connected display,
 * screen-level pointer, drag and wheel input, real keyboard chords and typing into the foreground window (the
 * Start menu, taskbar, shell shortcuts and apps that ignore posted messages), top-level window management, and
 * opening files, folders, URLs and settings pages.
 * @module @hackdevcode/dsh-experimental-computer-use-cua-driver-native/displays
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@hackdevcode/cordis'
import { createMcpToolDefinition } from '@hackdevcode/dsh-mcp-client'
import { defineTool } from '@hackdevcode/dsh-tools'
import { parseKeys } from './keys.ts'
import type { Chord } from './keys.ts'
import { PowerShellHost } from './powershell.ts'
import type { ScriptRunner } from './powershell.ts'
import { ElevatedInput, opScript } from './elevated.ts'
import type { HelperLauncher, InputOp } from './elevated.ts'

/** One monitor in virtual-desktop pixels; a display left of or above the primary has negative coordinates. */
export interface DisplayInfo {
  /** Zero-based index used by the other display tools. */
  index: number
  /** Platform name of the output, such as `\\.\DISPLAY2` or `HDMI-1`. */
  name: string
  primary: boolean
  x: number
  y: number
  width: number
  height: number
}

/** One top-level window. */
export interface WindowInfo {
  /** Native window handle (HWND on Windows, X11 window id on Linux). */
  handle: number
  pid: number
  /** Process name when the platform reports it. */
  process: string
  title: string
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
  foreground: boolean
  /** The window's app runs as administrator (Windows); real input to it goes through the administrator helper. */
  elevated?: boolean
}

/** Window operations that `desktop_window` performs. */
export type WindowAction = 'focus' | 'minimize' | 'maximize' | 'restore' | 'close'

/** Pointer button for screen-level input. */
export type PointerButton = 'left' | 'right' | 'middle'

/** A rectangle of the virtual desktop to capture, such as one display or one window. */
export type CaptureArea = Pick<DisplayInfo, 'x' | 'y' | 'width' | 'height'>

/** Size of a saved capture after any downscale. */
export interface CaptureResult {
  width: number
  height: number
  /** Saved pixels per screen pixel; 1 when the capture was not reduced. */
  scale: number
}

/** Runs one helper program and returns its standard output, within `timeoutMs` (default 30 s). */
export type CommandRunner = (file: string, args: readonly string[], timeoutMs?: number) => Promise<string>

/** Default runner: no shell, bounded time, Windows console window hidden. */
export const runCommand: CommandRunner = (file, args, timeoutMs = 30_000) => new Promise((resolve, reject) => {
  execFile(file, [...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error !== null) reject(new Error(`${file} failed: ${stderr.trim() || error.message}`))
    else resolve(stdout)
  })
})

/** Desktop operations of one platform. */
export interface DisplayBackend {
  list(): Promise<DisplayInfo[]>
  /** Capture one display, or the whole virtual desktop, into a PNG no larger than `maxDimension` on its long side. */
  capture(path: string, area: CaptureArea | undefined, maxDimension: number): Promise<CaptureResult>
  /** Move the real pointer, then press the button `count` times unless `button` is `none`, holding `modifiers` while clicking. */
  pointer(x: number, y: number, button: PointerButton | 'none', count: number, modifiers?: Chord, signal?: AbortSignal): Promise<void>
  /** Press at one point, move in steps, release at another. */
  drag(fromX: number, fromY: number, toX: number, toY: number, button: PointerButton, signal?: AbortSignal): Promise<void>
  /** Turn the wheel at a point; positive `clicks` scroll up or right. */
  scroll(x: number, y: number, clicks: number, horizontal: boolean, signal?: AbortSignal): Promise<void>
  /** Press each chord in order with real keyboard input to the foreground window. */
  keys(chords: readonly Chord[], signal?: AbortSignal): Promise<void>
  /**
   * Type text with real keyboard input to the foreground window; newlines press Enter. With `paste`, put the text on
   * the clipboard, press ctrl+v and restore the earlier clipboard text, which is much faster for long text.
   */
  type(text: string, paste?: boolean, signal?: AbortSignal): Promise<void>
  windows(): Promise<WindowInfo[]>
  window(handle: number, action: WindowAction, signal?: AbortSignal): Promise<void>
  /** Open a file, folder, URL or settings page with its default handler. */
  open(target: string): Promise<void>
  /** The visible text of one window: control types, names and values, indented by depth and bounded in size. */
  readText(handle: number): Promise<string>
  /** Stop helper processes. */
  close(): void
}

/** Native helper compiled once per PowerShell session; physical pixels across mixed-DPI monitors. */
/**
 * Native input and window helper, compiled once per PowerShell session and also by the administrator helper.
 * Coordinates are physical pixels across mixed-DPI monitors.
 */
export const DESK_CSHARP = String.raw`using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
namespace HackDev {
public class Monitor { public string name; public bool primary; public int x; public int y; public int width; public int height; }
public class Win { public long handle; public int pid; public string process; public string title; public int x; public int y; public int width; public int height; public bool minimized; public bool foreground; public bool elevated; }
public static class Desk {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONITORINFOEX { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
  delegate bool MonitorProc(IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int infoClass, out int info, int length, out int returned);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorProc proc, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out int value, int size);
  static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2C, 0x2D, 0x2E, 0x5B, 0x5C, 0x5D, 0x6F, 0x90 };
  public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
  static void Send(INPUT[] inputs) {
    if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT))) != inputs.Length)
      throw new Exception("Windows blocked the input (error " + Marshal.GetLastWin32Error() + "). The foreground window may belong to an app running as administrator, or a UAC prompt or the lock screen is showing.");
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) { INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
  static INPUT Mouse(uint flags, uint data) { INPUT i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i; }
  static uint Ext(ushort vk) { return Extended.Contains(vk) ? 1u : 0u; }
  public static void Chord(ushort[] keys) {
    List<INPUT> list = new List<INPUT>();
    foreach (ushort vk in keys) list.Add(Key(vk, 0, Ext(vk)));
    for (int j = keys.Length - 1; j >= 0; j--) list.Add(Key(keys[j], 0, Ext(keys[j]) | 2u));
    Send(list.ToArray());
  }
  public static void Text(string text) {
    List<INPUT> list = new List<INPUT>();
    foreach (char c in text) {
      if (c == '\r') continue;
      if (c == '\n') { list.Add(Key(0x0D, 0, 0)); list.Add(Key(0x0D, 0, 2)); }
      else { list.Add(Key(0, c, 4)); list.Add(Key(0, c, 6)); }
      if (list.Count >= 64 && !char.IsHighSurrogate(c)) { Send(list.ToArray()); list.Clear(); Thread.Sleep(10); }
    }
    if (list.Count > 0) Send(list.ToArray());
  }
  public static void Move(int x, int y) {
    if (!SetCursorPos(x, y)) throw new Exception("Windows refused to move the pointer to " + x + ", " + y + ". A window of an app running as administrator may be in front, or a UAC prompt or the lock screen is showing.");
  }
  /** Press modifier keys, click, then release the modifiers in reverse order (ctrl+click, shift+click). */
  public static void ClickWith(ushort[] modifiers, uint down, uint up, int count) {
    List<INPUT> press = new List<INPUT>();
    foreach (ushort vk in modifiers) press.Add(Key(vk, 0, Ext(vk)));
    if (press.Count > 0) { Send(press.ToArray()); Thread.Sleep(30); }
    try { Click(down, up, count); }
    finally {
      List<INPUT> release = new List<INPUT>();
      for (int j = modifiers.Length - 1; j >= 0; j--) release.Add(Key(modifiers[j], 0, Ext(modifiers[j]) | 2u));
      if (release.Count > 0) Send(release.ToArray());
    }
  }
  /** Whether a process runs elevated; a token this process may not open belongs to an elevated or protected process. */
  public static bool Elevated(uint pid) {
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return false;
    try {
      IntPtr token;
      if (!OpenProcessToken(process, 0x0008, out token)) return Marshal.GetLastWin32Error() == 5;
      try { int value, returned; return GetTokenInformation(token, 20, out value, 4, out returned) && value != 0; }
      finally { CloseHandle(token); }
    } finally { CloseHandle(process); }
  }
  public static bool SelfElevated() { return Elevated((uint)Process.GetCurrentProcess().Id); }
  static bool NeedsElevation(IntPtr h) {
    if (h == IntPtr.Zero || SelfElevated()) return false;
    uint pid; GetWindowThreadProcessId(h, out pid);
    return pid != 0 && Elevated(pid);
  }
  /** Whether messages to one window need an elevated sender. */
  public static bool WindowNeedsElevation(long h) { return NeedsElevation(new IntPtr(h)); }
  /** Whether real input to the foreground window needs an elevated sender. */
  public static bool ForegroundNeedsElevation() { return NeedsElevation(GetForegroundWindow()); }
  /**
   * Whether pointer input at a desktop point needs an elevated sender: the window under the point belongs to an
   * elevated app, or an elevated window is in front, which makes Windows refuse to move the pointer anywhere.
   */
  public static bool PointNeedsElevation(int x, int y) {
    if (ForegroundNeedsElevation()) return true;
    POINT p = new POINT(); p.X = x; p.Y = y;
    return NeedsElevation(GetAncestor(WindowFromPoint(p), 2));
  }
  public static void Click(uint down, uint up, int count) { for (int n = 0; n < count; n++) { Send(new INPUT[] { Mouse(down, 0), Mouse(up, 0) }); Thread.Sleep(60); } }
  public static void Drag(int x1, int y1, int x2, int y2, uint down, uint up) {
    Move(x1, y1); Thread.Sleep(60); Send(new INPUT[] { Mouse(down, 0) }); Thread.Sleep(60);
    int steps = Math.Max(8, Math.Min(40, (Math.Abs(x2 - x1) + Math.Abs(y2 - y1)) / 25));
    for (int s = 1; s <= steps; s++) { Move(x1 + (x2 - x1) * s / steps, y1 + (y2 - y1) * s / steps); Thread.Sleep(12); }
    Thread.Sleep(80); Send(new INPUT[] { Mouse(up, 0) });
  }
  public static void Wheel(int x, int y, int clicks, bool horizontal) { Move(x, y); Thread.Sleep(40); Send(new INPUT[] { Mouse(horizontal ? 0x1000u : 0x0800u, unchecked((uint)(clicks * 120))) }); }
  static string Title(IntPtr h) { StringBuilder s = new StringBuilder(512); GetWindowText(h, s, s.Capacity); return s.ToString(); }
  static bool Cloaked(IntPtr h) { int value; return DwmGetWindowAttribute(h, 14, out value, 4) == 0 && value != 0; }
  /** Every monitor, read from Windows on each call so plugging in or rearranging displays is seen at once. */
  public static List<Monitor> Monitors() {
    List<Monitor> result = new List<Monitor>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate (IntPtr monitor, IntPtr hdc, IntPtr rect, IntPtr data) {
      MONITORINFOEX info = new MONITORINFOEX(); info.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      if (GetMonitorInfo(monitor, ref info)) {
        Monitor m = new Monitor(); m.name = info.szDevice; m.primary = (info.dwFlags & 1) != 0;
        m.x = info.rcMonitor.Left; m.y = info.rcMonitor.Top; m.width = info.rcMonitor.Right - info.rcMonitor.Left; m.height = info.rcMonitor.Bottom - info.rcMonitor.Top;
        result.Add(m);
      }
      return true;
    }, IntPtr.Zero);
    result.Sort(delegate (Monitor a, Monitor b) { return a.primary != b.primary ? (a.primary ? -1 : 1) : (a.x != b.x ? a.x.CompareTo(b.x) : a.y.CompareTo(b.y)); });
    return result;
  }
  public static List<Win> Windows() {
    List<Win> result = new List<Win>();
    IntPtr fg = GetForegroundWindow();
    Dictionary<uint, string> names = new Dictionary<uint, string>();
    Dictionary<uint, bool> elevated = new Dictionary<uint, bool>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      // Owned windows stay listed: Run, Save As, Open and other dialogs are owned by their app.
      if (!IsWindowVisible(h) || Cloaked(h)) return true;
      string title = Title(h);
      if (title.Length == 0) return true;
      RECT r; GetWindowRect(h, out r);
      if (r.Right - r.Left <= 0 || r.Bottom - r.Top <= 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string name;
      if (!names.TryGetValue(pid, out name)) { try { name = Process.GetProcessById((int)pid).ProcessName; } catch { name = ""; } names[pid] = name; }
      Win w = new Win(); w.handle = h.ToInt64(); w.pid = (int)pid; w.process = name; w.title = title;
      w.x = r.Left; w.y = r.Top; w.width = r.Right - r.Left; w.height = r.Bottom - r.Top; w.minimized = IsIconic(h); w.foreground = h == fg;
      bool high;
      if (!elevated.TryGetValue(pid, out high)) { high = Elevated(pid); elevated[pid] = high; }
      w.elevated = high;
      result.Add(w); return true;
    }, IntPtr.Zero);
    return result;
  }
  public static string Foreground() { IntPtr h = GetForegroundWindow(); uint pid; GetWindowThreadProcessId(h, out pid); return h.ToInt64() + "|" + pid + "|" + Title(h); }
  public static void Focus(IntPtr h) {
    if (!IsWindow(h)) throw new Exception("no window with handle " + h.ToInt64());
    if (IsIconic(h)) ShowWindow(h, 9);
    uint ignored; uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored); uint me = GetCurrentThreadId();
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h); SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    for (int i = 0; i < 20 && GetForegroundWindow() != h; i++) Thread.Sleep(25);
    if (GetForegroundWindow() != h) {
      Send(new INPUT[] { Key(0x12, 0, 0), Key(0x12, 0, 2) }); SetForegroundWindow(h); Thread.Sleep(100);
      if (GetForegroundWindow() != h) throw new Exception("Windows kept another window in front of handle " + h.ToInt64());
    }
  }
  public static void Act(IntPtr h, string action) {
    if (!IsWindow(h)) throw new Exception("no window with handle " + h.ToInt64());
    if (action == "focus") Focus(h);
    else if (action == "minimize") ShowWindow(h, 6);
    else if (action == "maximize") ShowWindow(h, 3);
    else if (action == "restore") ShowWindow(h, 9);
    else if (action == "close") PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);
    else throw new Exception("unknown window action " + action);
  }
}
}`

export const WINDOWS_PRELUDE = String.raw`
$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
if (-not ('HackDev.Desk' -as [type])) {
Add-Type -TypeDefinition @'
${DESK_CSHARP}
'@
}
[HackDev.Desk]::Init()
if (-not ('HackDev.Uia' -as [type])) {
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
    $uiaRefs = @([System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location, [System.Windows.Rect].Assembly.Location)
    Add-Type -ReferencedAssemblies $uiaRefs -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Windows.Automation;
namespace HackDev {
public static class Uia {
  public static string Read(long handle, int maxItems, int maxChars, int maxMs) {
    AutomationElement root = AutomationElement.FromHandle(new IntPtr(handle));
    TreeWalker walker = TreeWalker.ControlViewWalker;
    StringBuilder text = new StringBuilder();
    HashSet<string> seen = new HashSet<string>();
    Stopwatch clock = Stopwatch.StartNew();
    Stack<KeyValuePair<AutomationElement, int>> stack = new Stack<KeyValuePair<AutomationElement, int>>();
    stack.Push(new KeyValuePair<AutomationElement, int>(root, 0));
    int count = 0;
    while (stack.Count > 0 && count < maxItems && text.Length < maxChars && clock.ElapsedMilliseconds < maxMs) {
      KeyValuePair<AutomationElement, int> next = stack.Pop();
      string name = "", type = "", value = "";
      try {
        name = next.Key.Current.Name ?? "";
        type = next.Key.Current.ControlType.ProgrammaticName.Replace("ControlType.", "");
        object pattern;
        if (next.Key.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) value = ((ValuePattern)pattern).Current.Value ?? "";
      } catch { }
      string line = type + ": " + name + (value.Length > 0 && value != name ? " = " + value : "");
      if ((name.Trim().Length > 0 || value.Trim().Length > 0) && seen.Add(line)) {
        text.Append(new string(' ', Math.Min(next.Value, 8) * 2)).Append(line.Length > 300 ? line.Substring(0, 300) + "..." : line).Append('\n');
        count++;
      }
      List<AutomationElement> children = new List<AutomationElement>();
      try {
        AutomationElement child = walker.GetFirstChild(next.Key);
        while (child != null && children.Count < 200) { children.Add(child); child = walker.GetNextSibling(child); }
      } catch { }
      for (int i = children.Count - 1; i >= 0; i--) stack.Push(new KeyValuePair<AutomationElement, int>(children[i], next.Value + 1));
    }
    if (stack.Count > 0) text.Append("... more elements were not read\n");
    return text.ToString();
  }
}
}
'@
  } catch { }
}
`

/** Copy every clipboard format into a session variable, retrying while another app holds the clipboard open. */
const CLIPBOARD_SAVE = '$global:hackdevClipboard = $null; $global:hackdevClipboardSaved = $false; $missed = 0; for ($i = 0; $i -lt 10; $i++) { try { '
  + '$missed = 0; $d = [System.Windows.Forms.Clipboard]::GetDataObject(); if ($null -ne $d) { $c = New-Object System.Windows.Forms.DataObject; '
  + 'foreach ($f in $d.GetFormats($false)) { try { $v = $d.GetData($f, $false); if ($null -ne $v) { $c.SetData($f, $false, $v) } else { $missed++ } } catch { $missed++ } }; '
  + 'if ($c.GetFormats().Length -gt 0) { $global:hackdevClipboard = $c } }; '
  // A format that could not be copied would be lost by the paste, so the clipboard counts as unsaved and the text is typed instead.
  + '$global:hackdevClipboardSaved = $missed -eq 0; break } catch { Start-Sleep -Milliseconds 50 } }; '
  + "if ($global:hackdevClipboardSaved) { 'SAVED' } elseif ($missed -gt 0) { 'PARTIAL' } else { 'BUSY' }"

/** Put the saved clipboard back, or clear it when it held nothing; only after a successful save. */
const CLIPBOARD_RESTORE = '$r = $false; if ($global:hackdevClipboardSaved) { for ($i = 0; $i -lt 10; $i++) { try { if ($null -ne $global:hackdevClipboard) { '
  + '[System.Windows.Forms.Clipboard]::SetDataObject($global:hackdevClipboard, $true) } else { [System.Windows.Forms.Clipboard]::Clear() }; '
  + '$global:hackdevClipboard = $null; $r = $true; break } catch { Start-Sleep -Milliseconds 50 } } }; $global:hackdevClipboardSaved = $false; '
  + "if ($r) { 'RESTORED' } else { 'LOST' }"

/** Every monitor as JSON, read fresh from Windows: device name, whether primary, and bounds in physical pixels. */
const LIST_SCREENS = '@([HackDev.Desk]::Monitors()) | ConvertTo-Json -Compress'

/** Quote a value for a single-quoted PowerShell string. */
export function psQuote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`
}

/** Parse JSON that PowerShell writes for one object or an array of them. */
function jsonList<T>(out: string): T[] {
  const text = out.trim()
  if (text.length === 0) return []
  const parsed = JSON.parse(text) as T | T[]
  return Array.isArray(parsed) ? parsed : [parsed]
}

/** Scale that fits `width` x `height` inside `maxDimension`. */
export function fitScale(width: number, height: number, maxDimension: number): number {
  const longest = Math.max(width, height)
  return longest <= maxDimension ? 1 : maxDimension / longest
}

/** SendInput mouse flags for pressing and releasing each button. */
const BUTTON_FLAGS: Readonly<Record<PointerButton, readonly [number, number]>> = {
  left: [0x2, 0x4], right: [0x8, 0x10], middle: [0x20, 0x40],
}

/** How the Windows backend reaches windows of apps that run as administrator. */
export interface WindowsBackendOptions {
  /** `ask` (default) starts the administrator helper when needed, after the person approves the UAC prompt; `off` refuses. */
  elevation?: 'ask' | 'off'
  /** Starts the helper; replaceable in tests. Defaults to "Run as administrator" through the PowerShell session. */
  launchHelper?: HelperLauncher
  /** Helper connection settings. */
  helper?: { connectTimeoutMs?: number }
}

/** Model-facing message for a declined UAC prompt. */
const DECLINED = 'the person declined the administrator prompt, so input to the administrator window was not sent'

/**
 * Load PowerShell modules only from the system folder, which only administrators can change. A module in the user's
 * own module folder could otherwise stand in for a built-in command such as Start-Process.
 */
const SYSTEM_MODULES = "$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')"

/**
 * The command that starts the helper process and prints its id, or `DECLINED` when the person declines the UAC
 * prompt. A declined prompt is recognized by Win32 error 1223 (ERROR_CANCELLED), whatever language Windows shows
 * its message in.
 * @param encoded - the bootstrap as a base64 UTF-16 `-EncodedCommand` value.
 * @param verb - `RunAs` for the UAC prompt; `Open` starts the helper unelevated, for tests.
 * @returns the PowerShell command.
 */
export function helperStartCommand(encoded: string, verb: 'RunAs' | 'Open'): string {
  return `${SYSTEM_MODULES}; try { (Start-Process -PassThru -FilePath powershell.exe${verb === 'RunAs' ? ' -Verb RunAs' : ''} -WindowStyle Hidden `
    + `-ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}').Id } catch { `
    + '$e = $_.Exception; while ($null -ne $e -and -not ($e -is [System.ComponentModel.Win32Exception])) { $e = $e.InnerException }; '
    + "if ($null -ne $e -and $e.NativeErrorCode -eq 1223) { 'DECLINED' } else { throw } }"
}

/** How long the person has to answer the UAC prompt for the administrator helper. */
const ELEVATION_PROMPT_MS = 120_000

/** Marker the normal session prints instead of acting when the target window needs the administrator helper. */
const NEEDS_ELEVATION = 'HACKDEV_NEEDS_ELEVATION'

/**
 * The short command that starts the administrator helper. It runs the helper script only when the file's SHA-256
 * matches, from the very bytes it checked. Hardened for an elevated start: before any command runs, modules load
 * only from the system folder (a same-user module folder could otherwise shadow a cmdlet), and compilation uses a
 * temporary folder only administrators and SYSTEM can write to (the user's %TEMP% would let another process swap
 * the compiled helper).
 * @param file - path of the helper script.
 * @param hash - uppercase hex SHA-256 of its bytes.
 * @param harden - lock down modules and the compile folder; off only for unelevated test starts.
 * @returns the PowerShell command.
 */
export function helperBootstrap(file: string, hash: string, harden: boolean): string {
  const lockdown = harden
    ? "$env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules'); "
      + "$t = [IO.Path]::Combine([Environment]::GetFolderPath('Windows'), 'Temp', 'hackdev-' + [Guid]::NewGuid().ToString('N')); "
      + '$a = [System.Security.AccessControl.DirectorySecurity]::new(); $a.SetAccessRuleProtection($true, $false); '
      + "foreach ($id in 'S-1-5-32-544', 'S-1-5-18') { $a.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new("
      + "[System.Security.Principal.SecurityIdentifier]::new($id), 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow')) }; "
      + '[void][IO.Directory]::CreateDirectory($t, $a); $env:TMP = $t; $env:TEMP = $t; '
    : '$t = $null; '
  return lockdown
    + `$b = [IO.File]::ReadAllBytes(${psQuote(file)}); `
    + `if (([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)) -replace '-', '') -ne '${hash}') { exit 1 }; `
    + 'try { & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString($b))) } finally { if ($null -ne $t) { try { [IO.Directory]::Delete($t, $true) } catch { } } }'
}

/**
 * Start the administrator helper through Windows' own "Run as administrator" prompt. The helper script goes to a
 * temporary file and a short bootstrap runs it only when its SHA-256 matches, from the bytes it checked, so a file
 * swapped after writing is refused. The wait for the person's answer runs in its own short-lived PowerShell
 * process, so it never holds up other desktop steps and cancelling it stops nothing but that wait.
 * @param verb - `RunAs` for the UAC prompt; `Open` starts the same helper unelevated, for tests.
 * @returns the launcher.
 */
export function uacLauncher(verb: 'RunAs' | 'Open' = 'RunAs'): HelperLauncher {
  return async (script, signal) => {
    signal?.throwIfAborted()
    const directory = await mkdtemp(join(tmpdir(), 'hackdev-admin-'))
    const file = join(directory, 'helper.ps1')
    const bytes = Buffer.from(script, 'utf8')
    await writeFile(file, bytes)
    // Removed shortly after the helper starts, and in any case when this process exits.
    const removeOnExit = (): void => { rmSync(directory, { recursive: true, force: true }) }
    process.once('exit', removeOnExit)
    const hash = createHash('sha256').update(bytes).digest('hex').toUpperCase()
    const bootstrap = helperBootstrap(file, hash, verb === 'RunAs')
    const encoded = Buffer.from(bootstrap, 'utf16le').toString('base64')
    const start = helperStartCommand(encoded, verb)
    try {
      const id = await new Promise<string>((resolve, reject) => {
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', start], {
          timeout: ELEVATION_PROMPT_MS, windowsHide: true, ...signal === undefined ? {} : { signal },
        }, (error, stdout, stderr) => {
          if (error === null) resolve(stdout)
          else reject(new Error(stderr.trim() || error.message, { cause: error }))
        })
      })
      if (id.trim() === 'DECLINED') throw new Error(DECLINED)
      return Number(id.trim())
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new Error('the administrator prompt wait was cancelled')
      throw error
    } finally {
      // The helper reads the script once at start; give it a moment, then remove the file.
      setTimeout(() => {
        process.off('exit', removeOnExit)
        void rm(directory, { recursive: true, force: true }).catch(() => {})
      }, 30_000).unref()
    }
  }
}

/**
 * Windows backend through one reused Windows PowerShell session and .NET, which every Windows 10 and 11 has. Real
 * input for a window of an app that runs as administrator goes through the administrator helper.
 * @param run - script runner; defaults to a persistent session with the native helper loaded.
 * @param options - administrator helper settings.
 * @returns the backend.
 */
export function windowsBackend(run?: ScriptRunner, options: WindowsBackendOptions = {}): DisplayBackend {
  const host = run === undefined ? new PowerShellHost(WINDOWS_PRELUDE) : undefined
  const ps = (script: string, timeoutMs?: number, signal?: AbortSignal): Promise<string> => {
    if (run !== undefined) {
      signal?.throwIfAborted()
      return run(script)
    }
    return (host as PowerShellHost).run(script, timeoutMs, signal)
  }
  const int = (value: number): string => String(Math.round(value))
  let elevated: ElevatedInput | undefined
  let pasting: Promise<void> = Promise.resolve()
  /**
   * Perform input in the normal session, or through the administrator helper when the window that receives it
   * (the foreground window, or the one under `at`) belongs to an app running as administrator.
   */
  const input = async (
    ops: readonly InputOp[],
    at?: { x: number; y: number } | { handle: number },
    signal?: AbortSignal,
  ): Promise<void> => {
    // Typing sends 32 characters per batch with a short pause, so long text needs more than the default limit.
    const typed = ops.reduce((sum, op) => sum + (op.op === 'text' ? op.text.length : 0), 0)
    const check = at === undefined
      ? '[HackDev.Desk]::ForegroundNeedsElevation()'
      : 'handle' in at
        ? `[HackDev.Desk]::WindowNeedsElevation(${int(at.handle)})`
        : `[HackDev.Desk]::PointNeedsElevation(${int(at.x)}, ${int(at.y)})`
    const out = await ps(`if (${check}) { '${NEEDS_ELEVATION}' } else { ${ops.map(opScript).join('; ')} }`, 30_000 + typed * 2, signal)
    if (out.trim() !== NEEDS_ELEVATION) return
    await helper().run(ops, signal)
  }
  /** The administrator helper client, or a refusal when the helper is turned off. */
  const helper = (): ElevatedInput => {
    if (options.elevation === 'off') {
      throw new Error('the target window belongs to an app running as administrator, and the administrator helper is turned off; ask the person to do this step or to run Hack Dev Code as administrator')
    }
    elevated ??= new ElevatedInput(DESK_CSHARP, options.launchHelper ?? uacLauncher(), ps, options.helper)
    return elevated
  }
  const buttons = (button: PointerButton): { down: number; up: number } => ({ down: BUTTON_FLAGS[button][0], up: BUTTON_FLAGS[button][1] })
  return {
    async list() {
      return jsonList<Omit<DisplayInfo, 'index'>>(await ps(LIST_SCREENS)).map((display, index) => ({ index, ...display }))
    },
    async capture(path, area, maxDimension) {
      const bounds = area === undefined ? '[System.Windows.Forms.SystemInformation]::VirtualScreen' : `New-Object System.Drawing.Rectangle(${int(area.x)}, ${int(area.y)}, ${int(area.width)}, ${int(area.height)})`
      const out = await ps(`$b = ${bounds}; $bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height); $g = [System.Drawing.Graphics]::FromImage($bmp); `
        + '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size); $g.Dispose(); '
        + `$s = [Math]::Min(1.0, ${int(maxDimension)} / [double][Math]::Max($b.Width, $b.Height)); $w = [int][Math]::Round($b.Width * $s); $h = [int][Math]::Round($b.Height * $s); `
        + 'if ($s -lt 1.0) { $small = New-Object System.Drawing.Bitmap($w, $h); $sg = [System.Drawing.Graphics]::FromImage($small); '
        + '$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $sg.DrawImage($bmp, 0, 0, $w, $h); $sg.Dispose(); $bmp.Dispose(); $bmp = $small }; '
        + `$bmp.Save(${psQuote(path)}, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); "$w $h $s"`)
      const [width, height, scale] = out.trim().split(/\s+/u).map(Number)
      return { width: width ?? 0, height: height ?? 0, scale: scale ?? 1 }
    },
    async pointer(x, y, button, count, modifiers, signal) {
      const ops: InputOp[] = [{ op: 'move', x, y }, { op: 'sleep', ms: 40 }]
      if (button !== 'none') ops.push({ op: 'click', mods: modifiers?.vk ?? [], ...buttons(button), count })
      await input(ops, { x, y }, signal)
    },
    async drag(fromX, fromY, toX, toY, button, signal) {
      await input([{ op: 'drag', x1: fromX, y1: fromY, x2: toX, y2: toY, ...buttons(button) }], { x: fromX, y: fromY }, signal)
    },
    async scroll(x, y, clicks, horizontal, signal) {
      await input([{ op: 'wheel', x, y, clicks, horizontal }], { x, y }, signal)
    },
    async keys(chords, signal) {
      const ops = chords.flatMap((chord, index): InputOp[] => index === 0 ? [{ op: 'chord', vks: chord.vk }] : [{ op: 'sleep', ms: 60 }, { op: 'chord', vks: chord.vk }])
      await input(ops, undefined, signal)
    },
    type(text, paste, signal) {
      if (paste !== true) return input([{ op: 'text', text }], undefined, signal)
      // Pastes run one at a time: each one saves, replaces and restores the same clipboard.
      const next = pasting.then(async () => {
        // Everything that can wait or be cancelled happens while the clipboard is still untouched: choosing the route
        // and, for an administrator window, starting the helper with its UAC prompt.
        const route = await ps(`if ([HackDev.Desk]::ForegroundNeedsElevation()) { '${NEEDS_ELEVATION}' }`, undefined, signal)
        if (route.trim() === NEEDS_ELEVATION) await helper().prepare(signal)
        signal?.throwIfAborted()
        // The clipboard belongs to the person: copy every format it holds, and put them back (or clear it) after the
        // paste. The copy stays inside the PowerShell session; it never passes through this process or the model.
        // When the clipboard cannot be fully read (another app holds it, or a format cannot be copied), type instead
        // rather than risk losing its content. From here on nothing is cancelled, so the restore always runs.
        const saved = await ps(`${CLIPBOARD_SAVE}; if ($global:hackdevClipboardSaved) { `
          + `[System.Windows.Forms.Clipboard]::SetText([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(text, 'utf8').toString('base64')}'))) }`)
        if (saved.trim() !== 'SAVED') {
          await input([{ op: 'text', text }], undefined, signal)
          return
        }
        let failure: Error | undefined
        try {
          // Slow apps (Electron, remote sessions, large pastes) read the clipboard after the key press returns.
          await input([{ op: 'chord', vks: [0x11, 0x56] }, { op: 'sleep', ms: 600 + Math.min(2400, Math.round(text.length / 20)) }])
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error))
        }
        const restored = (await ps(CLIPBOARD_RESTORE).catch(() => '')).trim() === 'RESTORED'
        if (failure !== undefined) {
          throw new Error(`the paste failed (${failure.message})${restored ? '' : ', and the clipboard\'s earlier content could not be put back'}`, { cause: failure })
        }
        if (!restored) throw new Error('the text was pasted, but the clipboard\'s earlier content could not be put back')
      })
      pasting = next.catch(() => {})
      return next
    },
    async windows() {
      return jsonList<WindowInfo>(await ps('@([HackDev.Desk]::Windows()) | ConvertTo-Json -Compress'))
    },
    async window(handle, action, signal) {
      await input([{ op: 'act', handle, action }], { handle }, signal)
    },
    async open(target) {
      await ps(`Start-Process -FilePath ${psQuote(target)}`)
    },
    async readText(handle) {
      return ps(`if (-not ('HackDev.Uia' -as [type])) { throw 'UI Automation is not available on this system' }; [HackDev.Uia]::Read(${String(Math.trunc(handle))}, 300, 8000, 4000)`)
    },
    close() {
      elevated?.close()
      host?.close()
    },
  }
}

/**
 * Parse `xrandr --query` monitor lines such as `HDMI-1 connected primary 1920x1080+1920+0 ...`.
 * @param text - xrandr output.
 * @returns the active displays.
 */
export function parseXrandr(text: string): DisplayInfo[] {
  const displays: DisplayInfo[] = []
  for (const line of text.split(/\r?\n/u)) {
    const [, name, primary, width, height, x, y] = /^(\S+) connected (primary )?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/u.exec(line) ?? []
    if (name === undefined || width === undefined || height === undefined || x === undefined || y === undefined) continue
    displays.push({
      index: displays.length, name, primary: primary !== undefined,
      x: Number(x), y: Number(y), width: Number(width), height: Number(height),
    })
  }
  return displays
}

/**
 * Parse `wmctrl -lpG` lines: id, desktop, pid, x, y, width, height, host, title.
 * @param text - wmctrl output.
 * @param active - X11 id of the focused window, or undefined.
 * @returns the windows on a desktop (sticky panels with desktop -1 are left out).
 */
export function parseWmctrl(text: string, active?: number): WindowInfo[] {
  const windows: WindowInfo[] = []
  for (const line of text.split(/\r?\n/u)) {
    const match = /^(0x[0-9a-f]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s*(.*)$/iu.exec(line)
    if (match === null || match[2] === '-1') continue
    const handle = Number.parseInt(match[1] ?? '0', 16)
    windows.push({
      handle, pid: Number(match[3]), process: '', title: (match[8] ?? '').trim(),
      x: Number(match[4]), y: Number(match[5]), width: Number(match[6]), height: Number(match[7]),
      minimized: false, foreground: handle === active,
    })
  }
  return windows
}

/**
 * Wait for an operation, but let the caller stop waiting when its signal aborts; the operation itself goes on.
 * @param operation - the operation.
 * @param signal - the caller's signal.
 * @returns the operation's result, unless the signal aborts first.
 */
function untilCancelled<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('the desktop step was cancelled')) }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/** Packages that provide the Linux helpers on Debian and Ubuntu. */
export const LINUX_HELPERS = 'sudo apt-get install -y x11-xserver-utils xdotool imagemagick wmctrl xdg-utils'

/** Packages for reading window text through AT-SPI on Debian and Ubuntu. */
export const ATSPI_HELPERS = 'sudo apt-get install -y python3-gi gir1.2-atspi-2.0 at-spi2-core'

/**
 * Python that prints the accessible text of one window: the application with the given process id, its frame with
 * the given title (or its first frame), walked depth first within 300 elements, 8000 characters and 4 seconds, in
 * the same `Role: name = value` form as on Windows.
 */
export const ATSPI_READER = String.raw`
import sys, time
import gi
gi.require_version('Atspi', '2.0')
from gi.repository import Atspi
pid, title = int(sys.argv[1]), sys.argv[2]
desktop = Atspi.get_desktop(0)
frame = None
for i in range(desktop.get_child_count()):
    app = desktop.get_child_at_index(i)
    try:
        if app is None or app.get_process_id() != pid:
            continue
    except Exception:
        continue
    frames = [app.get_child_at_index(j) for j in range(app.get_child_count())]
    frames = [f for f in frames if f is not None]
    named = [f for f in frames if (f.get_name() or '') == title]
    frame = (named or frames or [None])[0]
    break
if frame is None:
    sys.exit('no accessible window for this process; the app may not expose accessibility')
start, out, seen, count = time.time(), [], set(), 0
stack = [(frame, 0)]
while stack and count < 300 and sum(len(l) + 1 for l in out) < 8000 and time.time() - start < 4:
    node, depth = stack.pop()
    try:
        role = (node.get_role_name() or '').title().replace(' ', '')
        name = node.get_name() or ''
        value = ''
        text = node.get_text_iface() if hasattr(node, 'get_text_iface') else None
        if text is not None:
            value = Atspi.Text.get_text(text, 0, min(Atspi.Text.get_character_count(text), 2000)) or ''
        line = role + ': ' + name + (' = ' + value if value and value != name else '')
        if (name.strip() or value.strip()) and line not in seen:
            seen.add(line)
            out.append('  ' * min(depth, 8) + (line[:300] + '...' if len(line) > 300 else line))
            count += 1
        children = [node.get_child_at_index(k) for k in range(min(node.get_child_count(), 200))]
        for child in reversed([c for c in children if c is not None]):
            stack.append((child, depth + 1))
    except Exception:
        continue
if stack:
    out.append('... more elements were not read')
print('\n'.join(out))
`

const X11_BUTTONS: Readonly<Record<PointerButton, string>> = { left: '1', middle: '2', right: '3' }

/**
 * Linux (X11) backend through xrandr, ImageMagick, xdotool, wmctrl and xdg-open.
 * @param run - helper runner.
 * @param env - environment used to tell Wayland apart.
 * @returns the backend.
 */
export function linuxBackend(
  run: CommandRunner = runCommand,
  env: Readonly<Record<string, string | undefined>> = process.env,
): DisplayBackend {
  const helper = async (file: string, args: readonly string[], signal?: AbortSignal, timeoutMs?: number): Promise<string> => {
    // A cancelled caller stops waiting at once, but xdotool is never killed midway: that could leave a key or mouse
    // button held down.
    signal?.throwIfAborted()
    try { return await untilCancelled(run(file, args, timeoutMs), signal) } catch (error) {
      if (signal?.aborted === true) throw error
      const wayland = (env['WAYLAND_DISPLAY'] ?? '').length > 0 && (env['DISPLAY'] ?? '').length === 0
      throw new Error(`${String(error instanceof Error ? error.message : error)}. ${wayland
        ? 'This is a Wayland session without XWayland; log in to an Xorg session for full desktop control.'
        : `Install the helpers with: ${LINUX_HELPERS}`}`, { cause: error })
    }
  }
  const int = (value: number): string => String(Math.round(value))
  const hex = (handle: number): string => `0x${Math.trunc(handle).toString(16)}`
  const list = async (): Promise<DisplayInfo[]> => parseXrandr(await helper('xrandr', ['--query']))
  return {
    list,
    async capture(path, display, maxDimension) {
      const area = display ?? (await list()).reduce<CaptureArea | undefined>((all, next) => all === undefined ? next : {
        ...all,
        x: Math.min(all.x, next.x), y: Math.min(all.y, next.y),
        width: Math.max(all.x + all.width, next.x + next.width) - Math.min(all.x, next.x),
        height: Math.max(all.y + all.height, next.y + next.height) - Math.min(all.y, next.y),
      }, undefined)
      const offset = (value: number): string => {
        const rounded = Math.round(value)
        return rounded < 0 ? String(rounded) : `+${String(rounded)}`
      }
      const crop = display === undefined ? [] : ['-crop', `${int(display.width)}x${int(display.height)}${offset(display.x)}${offset(display.y)}`]
      const scale = area === undefined ? 1 : fitScale(area.width, area.height, maxDimension)
      const resize = scale < 1 ? ['-resize', `${int(maxDimension)}x${int(maxDimension)}>`] : []
      await helper('import', ['-window', 'root', ...crop, ...resize, path])
      return { width: Math.round((area?.width ?? 0) * scale), height: Math.round((area?.height ?? 0) * scale), scale }
    },
    async pointer(x, y, button, count, modifiers, signal) {
      const held = button === 'none' || modifiers === undefined ? [] : modifiers.x11.split('+')
      const press = button === 'none' ? [] : [
        ...held.flatMap(key => ['keydown', key]),
        'click', '--repeat', String(count), X11_BUTTONS[button],
        ...held.toReversed().flatMap(key => ['keyup', key]),
      ]
      await helper('xdotool', ['mousemove', '--sync', int(x), int(y), ...press], signal)
    },
    async drag(fromX, fromY, toX, toY, button, signal) {
      await helper('xdotool', ['mousemove', '--sync', int(fromX), int(fromY), 'mousedown', X11_BUTTONS[button],
        'sleep', '0.1', 'mousemove', '--sync', int(toX), int(toY), 'sleep', '0.1', 'mouseup', X11_BUTTONS[button]], signal)
    },
    async scroll(x, y, clicks, horizontal, signal) {
      const wheel = horizontal ? (clicks > 0 ? '7' : '6') : (clicks > 0 ? '4' : '5')
      await helper('xdotool', ['mousemove', '--sync', int(x), int(y), 'click', '--repeat', String(Math.abs(Math.round(clicks))), wheel], signal)
    },
    async keys(chords, signal) {
      await helper('xdotool', ['key', '--clearmodifiers', ...chords.map(chord => chord.x11)], signal)
    },
    async type(text, _paste, signal) {
      // xdotool waits 12 ms per character, so long text needs more than the default limit.
      await helper('xdotool', ['type', '--clearmodifiers', '--delay', '12', '--', text], signal, 30_000 + text.length * 15)
    },
    async windows() {
      const active = await helper('xdotool', ['getactivewindow']).then(out => Number(out.trim()), () => undefined)
      return parseWmctrl(await helper('wmctrl', ['-lpG']), active)
    },
    async window(handle, action, signal) {
      const id = hex(handle)
      if (action === 'focus' || action === 'restore') await helper('wmctrl', ['-ia', id], signal)
      else if (action === 'minimize') await helper('xdotool', ['windowminimize', String(Math.trunc(handle))], signal)
      else if (action === 'maximize') await helper('wmctrl', ['-ir', id, '-b', 'add,maximized_vert,maximized_horz'], signal)
      else await helper('wmctrl', ['-ic', id], signal)
    },
    async open(target) {
      await helper('xdg-open', [target])
    },
    async readText(handle) {
      const window = parseWmctrl(await helper('wmctrl', ['-lpG'])).find(candidate => candidate.handle === handle)
      if (window === undefined) throw new Error(`no window with handle ${String(handle)}`)
      try {
        return await run('python3', ['-c', ATSPI_READER, String(window.pid), window.title])
      } catch (error) {
        throw new Error(`${String(error instanceof Error ? error.message : error)}. Reading window text uses the accessibility bus: `
          + `install it with ${ATSPI_HELPERS} and make sure assistive technologies are enabled in the desktop settings, `
          + 'or capture the window with desktop_screenshot.', { cause: error })
      }
    },
    close() {},
  }
}

/**
 * The backend for this platform, or undefined where the platform's own provider covers every display.
 * @param platform - Node platform name.
 * @param options - Windows administrator helper settings.
 * @returns the backend.
 */
export function displayBackend(
  platform: NodeJS.Platform = process.platform,
  options: WindowsBackendOptions = {},
): DisplayBackend | undefined {
  if (platform === 'win32') return windowsBackend(undefined, options)
  if (platform === 'linux') return linuxBackend()
  return undefined
}

/** Find a display by index; throws a model-readable error for an unknown one. */
function pick(displays: readonly DisplayInfo[], index: number): DisplayInfo {
  const display = displays.find(candidate => candidate.index === index)
  if (display === undefined) throw new Error(`no display ${String(index)}; connected displays: ${displays.map(d => String(d.index)).join(', ') || 'none'}`)
  return display
}

/** Summary line for one display. */
function describe(display: DisplayInfo): string {
  return `${String(display.index)}: ${display.name}${display.primary ? ' (primary)' : ''} ${String(display.width)}x${String(display.height)} at (${String(display.x)}, ${String(display.y)})`
}

/** Summary line for one window. */
export function describeWindow(window: WindowInfo): string {
  const flags = [window.foreground ? 'foreground' : '', window.minimized ? 'minimized' : '', window.elevated === true ? 'administrator' : '']
    .filter(flag => flag.length > 0)
  return `handle ${String(window.handle)} pid ${String(window.pid)}${window.process.length > 0 ? ` ${window.process}` : ''} "${window.title}" `
    + `${String(window.width)}x${String(window.height)} at (${String(window.x)}, ${String(window.y)})${flags.length > 0 ? ` [${flags.join(', ')}]` : ''}`
}

/**
 * Choose one window by handle or by a case-insensitive title fragment.
 * @param windows - current top-level windows.
 * @param handle - exact handle, when given.
 * @param title - title fragment, when given.
 * @returns the window.
 * @throws when nothing matches, or a title matches several windows.
 */
export function selectWindow(windows: readonly WindowInfo[], handle?: number, title?: string): WindowInfo {
  if (handle !== undefined) {
    const found = windows.find(window => window.handle === handle)
    if (found === undefined) throw new Error(`no visible top-level window with handle ${String(handle)}; call desktop_window with action list`)
    return found
  }
  if (title === undefined || title.trim().length === 0) throw new Error('pass handle or title')
  const needle = title.trim().toLowerCase()
  const matches = windows.filter(window => window.title.toLowerCase().includes(needle))
  const exact = matches.filter(window => window.title.toLowerCase() === needle)
  if (exact.length === 1 && exact[0] !== undefined) return exact[0]
  if (matches.length === 1 && matches[0] !== undefined) return matches[0]
  if (matches.length === 0) throw new Error(`no window title contains "${title}"; open windows:\n${windows.map(describeWindow).join('\n')}`)
  throw new Error(`${String(matches.length)} windows match "${title}"; pass handle:\n${matches.map(describeWindow).join('\n')}`)
}

/**
 * Poll the window list until a window whose title contains `title` appears, or until none does when `gone`.
 * @param backend - platform backend.
 * @param title - title fragment, compared case-insensitively.
 * @param gone - wait for the window to close instead.
 * @param timeoutMs - limit, 500 to 60000 milliseconds.
 * @param signal - cancels the wait.
 * @param intervalMs - polling interval.
 * @returns a description of the window that appeared, or of the close.
 * @throws when the limit passes first.
 */
export async function waitForWindow(
  backend: Pick<DisplayBackend, 'windows'>, title: string | undefined, gone: boolean, timeoutMs: number, signal?: AbortSignal, intervalMs = 250,
): Promise<string> {
  const needle = (title ?? '').trim().toLowerCase()
  if (needle.length === 0) throw new Error('wait needs title')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 60_000) throw new Error('timeout_ms must be between 500 and 60000')
  const deadline = Date.now() + timeoutMs
  for (;;) {
    signal?.throwIfAborted()
    const match = (await backend.windows()).find(window => window.title.toLowerCase().includes(needle))
    if (gone && match === undefined) return `No window title contains "${title ?? ''}" any more.`
    if (!gone && match !== undefined) return `Appeared: ${describeWindow(match)}`
    if (Date.now() >= deadline) {
      throw new Error(gone
        ? `a window titled "${title ?? ''}" is still open after ${String(timeoutMs)} ms: ${match === undefined ? '' : describeWindow(match)}`
        : `no window title contained "${title ?? ''}" within ${String(timeoutMs)} ms`)
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

/**
 * Describe a window after an action from fresh state, so the result never repeats the state before the action.
 * A close is followed until the window is gone; a window that stays open is reported with the process's other
 * windows, which is where a save prompt appears.
 * @param backend - platform backend.
 * @param window - the window as it was before the action.
 * @param action - the action that was sent.
 * @param signal - cancels the follow-up.
 * @param settleMs - time for the window manager to apply the action.
 * @param closeMs - how long a close is followed.
 * @returns one line for the model.
 */
export async function windowOutcome(
  backend: Pick<DisplayBackend, 'windows'>, window: WindowInfo, action: WindowAction, signal?: AbortSignal, settleMs = 300, closeMs = 3000,
): Promise<string> {
  const deadline = Date.now() + (action === 'close' ? closeMs : settleMs)
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, Math.min(settleMs, 250)))
    signal?.throwIfAborted()
    const windows = await backend.windows()
    const now = windows.find(candidate => candidate.handle === window.handle)
    if (action === 'close' && now === undefined) return `Closed "${window.title}" (handle ${String(window.handle)}); it is no longer open.`
    if (action !== 'close' || Date.now() >= deadline) {
      if (now === undefined) return `${action}: "${window.title}" (handle ${String(window.handle)}) is no longer open.`
      if (action !== 'close') return `${action} done; now ${describeWindow(now)}`
      const others = windows.filter(candidate => candidate.pid === window.pid && candidate.handle !== window.handle)
      return `Asked "${window.title}" to close, but it is still open: ${describeWindow(now)}.`
        + (others.length > 0 ? ` Other windows of the same app, possibly a save prompt: ${others.map(describeWindow).join('; ')}` : ' It may be waiting for an answer inside the window.')
    }
  }
}

/** Text longer than this is pasted through the clipboard unless the caller asks for typing. */
const PASTE_THRESHOLD = 500

/**
 * Parse the keys held during a click, such as `ctrl` or `ctrl+shift`.
 * @param modifiers - key names joined with +, or undefined.
 * @returns one chord, or undefined when none is held.
 */
function heldKeys(modifiers: string | undefined): Chord | undefined {
  if (modifiers === undefined || modifiers.trim().length === 0) return undefined
  const chords = parseKeys(modifiers.replace(/\s+/gu, ''))
  return chords[0]
}

/** Guidance placed next to the desktop tools. */
export const DISPLAY_GUIDANCE = `Whole-desktop tools use the real mouse and keyboard, so they reach everything a person can: the Start menu, taskbar, system tray, notifications, desktop icons, shell shortcuts (win+r, win+e, win+d, alt+tab, ctrl+shift+esc), and apps that ignore background input (modern Notepad, Settings, many games and Electron or WinUI apps).
- Several monitors may be connected: desktop_list_displays shows each with its position on the virtual desktop. desktop_screenshot captures one display or all of them (scaled to max_dimension) and returns how to turn an image point into desktop coordinates.
- desktop_pointer, desktop_drag and desktop_scroll act at virtual-desktop coordinates on any display. desktop_keys presses key chords (ctrl+s, win+r, "alt+tab enter") and desktop_type types any text, both into the foreground window; pass window (a handle) or title to bring that window to the front first. Their result names the window that received the input: check it before continuing.
- desktop_window lists top-level windows and dialogs with handles and processes; focuses, minimizes, maximizes, restores or closes one (close asks the app to close, so it may show a save prompt); and waits for a window to appear or close, which beats repeated screenshots after launching or opening something. desktop_open opens a file, folder, URL or settings page such as ms-settings:display with its default app.
- Work in few steps; each tool call costs a full model round trip. Put actions whose outcome you can predict into one desktop_sequence call (open or launch, wait for the window, focus, type, press keys) and end it with a read step to check the result in the same call.
- Check results cheaply: desktop_window read (or a read step) returns a window's text, labels and values; use desktop_screenshot, which returns the image itself, only when layout or graphics matter, and capture one window rather than the whole screen. Window actions and waits already confirm their outcome, so do not list or capture again just to re-check them.
- Load desktop-more only for what the desktop group cannot do (background input to one window without moving the pointer, menus, exact frames, killing a process, browser page automation).
- Prefer the window tools (element tokens, background delivery) for precise work inside one app; switch to the real-input tools when background input is ignored or the target is part of the shell. Real input moves the person's pointer and focus.
- Windows marks windows of apps running as administrator with [administrator]. Real input to them goes through an administrator helper that Windows asks the person to approve once per session; if they decline, ask them to do that step. UAC prompts and the lock screen are on the secure desktop, which no program can operate: ask the person to answer them.
- Long text: desktop_type pastes through the clipboard above 500 characters (and restores the clipboard), which is far faster than typing. Hold keys during a click with modifiers, such as ctrl to add to a selection.`

type Group = { name: string; description: string }

const DONE_SCHEMA = { type: 'object', additionalProperties: false, properties: { done: { type: 'string', required: true } } } as const

/**
 * Register the whole-desktop tools.
 * @param ctx - context with the tool registry.
 * @param backend - platform backend.
 * @param group - on-demand group, when the tools load on demand.
 */
export function registerDisplayTools(ctx: Context, backend: DisplayBackend, group?: Group): void {
  const options = group === undefined ? {} : { group }
  const onDisplay = async (x: number, y: number): Promise<DisplayInfo> => {
    const displays = await backend.list()
    const on = displays.find(d => x >= d.x && x < d.x + d.width && y >= d.y && y < d.y + d.height)
    if (on === undefined) throw new Error(`(${String(x)}, ${String(y)}) is on no display; displays: ${displays.map(describe).join('; ')}`)
    return on
  }
  const button = (value: string | undefined): PointerButton => {
    const chosen = value ?? 'left'
    if (chosen !== 'left' && chosen !== 'right' && chosen !== 'middle') throw new Error('button must be left, right or middle')
    return chosen
  }
  /** Bring the requested window to the front, then report where real input will go. */
  const target = async (handle?: number, title?: string, signal?: AbortSignal): Promise<string> => {
    if (handle !== undefined || title !== undefined) {
      const window = selectWindow(await backend.windows(), handle, title)
      await backend.window(window.handle, 'focus', signal)
    }
    const front = (await backend.windows()).find(window => window.foreground)
    return front === undefined ? 'no window (the desktop or shell has focus)' : describeWindow(front)
  }
  const focusParameters = {
    window: { type: 'number', description: 'Handle of the window to bring to the front first (from desktop_window list).' },
    title: { type: 'string', description: 'Part of the title of the window to bring to the front first, when the handle is unknown.' },
  } as const

  ctx.tools.register(defineTool({
    name: 'desktop_list_displays',
    description: 'List every connected display with its index, name, whether it is primary, and its size and position in virtual-desktop pixels.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string', required: true }, count: { type: 'number', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    async execute() {
      const displays = await backend.list()
      return { summary: displays.length === 0 ? 'No display found.' : displays.map(describe).join('\n'), count: displays.length }
    },
  }), options)

  // Registered through the MCP result adapter, which stores the PNG as a durable attachment and shows it to models
  // that accept images, so seeing the screen takes one call instead of a capture plus a separate read.
  ctx.tools.register(createMcpToolDefinition(ctx, {
    name: 'desktop_screenshot',
    rawName: 'desktop_screenshot',
    description: 'Capture one window, one display, or the whole virtual desktop and return the image, scaled to max_dimension, with how image points map to desktop coordinates. '
      + 'Capture just the window you are working in when you can; it is smaller and clearer. To read a window\'s text, desktop_window with action read is cheaper than an image.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        window: { type: 'number', description: 'Handle of a window to capture (from desktop_window list).' },
        title: { type: 'string', description: 'Part of the title of a window to capture, when the handle is unknown.' },
        display: { type: 'number', description: 'Display index from desktop_list_displays; omit window, title and display to capture every display.' },
        max_dimension: { type: 'number', description: 'Longest side of the image in pixels (default 1280, 200 to 4096).' },
      },
    },
    async call(raw) {
      const args = raw as { window?: number; title?: string; display?: number; max_dimension?: number }
      const maxDimension = Math.round(args.max_dimension ?? 1280)
      if (!Number.isFinite(maxDimension) || maxDimension < 200 || maxDimension > 4096) throw new Error('max_dimension must be between 200 and 4096')
      const displays = await backend.list()
      let area: CaptureArea | undefined
      let label: string
      if (args.window !== undefined || args.title !== undefined) {
        const window = selectWindow(await backend.windows(), args.window, args.title)
        if (window.minimized) throw new Error(`"${window.title}" is minimized; restore it before capturing it`)
        area = window
        label = `window ${describeWindow(window)}`
      } else if (args.display !== undefined) {
        const display = pick(displays, args.display)
        area = display
        label = `display ${describe(display)}`
      } else {
        label = `all ${String(displays.length)} displays`
      }
      const directory = await mkdtemp(join(tmpdir(), 'hackdev-screen-'))
      const path = join(directory, 'screen.png')
      let size: CaptureResult
      let data: string
      try {
        size = await backend.capture(path, area, maxDimension)
        data = (await readFile(path)).toString('base64')
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => {})
      }
      const originX = area?.x ?? Math.min(0, ...displays.map(d => d.x))
      const originY = area?.y ?? Math.min(0, ...displays.map(d => d.y))
      const mapping = size.scale === 1
        ? `desktop x = ${String(originX)} + image x, desktop y = ${String(originY)} + image y`
        : `desktop x = ${String(originX)} + image x / ${size.scale.toFixed(4)}, desktop y = ${String(originY)} + image y / ${size.scale.toFixed(4)}`
      const text = `${label}, image ${String(size.width)}x${String(size.height)}. To act on a point in this image: ${mapping}.`
      return { content: [{ type: 'text', text }, { type: 'image', data, mimeType: 'image/png' }] }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_pointer',
    description: 'Move the real mouse pointer to virtual-desktop coordinates on any display and optionally click. Coordinates of a display start at its x and y from desktop_list_displays.',
    parameters: {
      x: { type: 'number', required: true, description: 'Virtual-desktop x in pixels.' },
      y: { type: 'number', required: true, description: 'Virtual-desktop y in pixels.' },
      button: { type: 'string', description: 'left (default), right, middle, or none to move only.' },
      count: { type: 'number', description: 'Clicks to send: 1 (default), 2 for a double-click, 3 for a triple-click.' },
      modifiers: { type: 'string', description: 'Keys held while clicking, such as ctrl (add to a selection), shift (extend it) or ctrl+shift.' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { x: number; y: number; button?: string; count?: number; modifiers?: string }, execution) {
      const pressed = args.button === 'none' ? 'none' : button(args.button)
      const count = args.count ?? 1
      if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('count must be 1, 2 or 3')
      const on = await onDisplay(args.x, args.y)
      const held = heldKeys(args.modifiers)
      await backend.pointer(args.x, args.y, pressed, count, held, execution.signal)
      const how = pressed === 'none' ? 'Moved to' : `${held === undefined ? '' : `${held.names.join('+')}+`}${pressed} click x${String(count)} at`
      return { done: `${how} (${String(args.x)}, ${String(args.y)}) on display ${describe(on)}` }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_drag',
    description: 'Press a mouse button at one virtual-desktop point, move smoothly to another (also across displays) and release: drag files, windows, sliders, selections or drawings.',
    parameters: {
      from_x: { type: 'number', required: true, description: 'Start x in virtual-desktop pixels.' },
      from_y: { type: 'number', required: true, description: 'Start y in virtual-desktop pixels.' },
      to_x: { type: 'number', required: true, description: 'End x in virtual-desktop pixels.' },
      to_y: { type: 'number', required: true, description: 'End y in virtual-desktop pixels.' },
      button: { type: 'string', description: 'left (default), right or middle.' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { from_x: number; from_y: number; to_x: number; to_y: number; button?: string }, execution) {
      const pressed = button(args.button)
      await onDisplay(args.from_x, args.from_y)
      await onDisplay(args.to_x, args.to_y)
      await backend.drag(args.from_x, args.from_y, args.to_x, args.to_y, pressed, execution.signal)
      return { done: `Dragged with ${pressed} from (${String(args.from_x)}, ${String(args.from_y)}) to (${String(args.to_x)}, ${String(args.to_y)})` }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_scroll',
    description: 'Turn the real mouse wheel over a virtual-desktop point, scrolling whatever is under it.',
    parameters: {
      x: { type: 'number', required: true, description: 'Virtual-desktop x in pixels.' },
      y: { type: 'number', required: true, description: 'Virtual-desktop y in pixels.' },
      direction: { type: 'string', required: true, description: 'up, down, left or right.' },
      amount: { type: 'number', description: 'Wheel notches, 1 to 50 (default 3); one notch is usually three lines.' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { x: number; y: number; direction: string; amount?: number }, execution) {
      const amount = Math.round(args.amount ?? 3)
      if (!Number.isFinite(amount) || amount < 1 || amount > 50) throw new Error('amount must be between 1 and 50')
      const sign = { up: 1, down: -1, right: 1, left: -1 }[args.direction]
      if (sign === undefined) throw new Error('direction must be up, down, left or right')
      await onDisplay(args.x, args.y)
      await backend.scroll(args.x, args.y, sign * amount, args.direction === 'left' || args.direction === 'right', execution.signal)
      return { done: `Scrolled ${args.direction} ${String(amount)} notches at (${String(args.x)}, ${String(args.y)})` }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_keys',
    description: 'Press key chords with the real keyboard into the foreground window or the shell: "ctrl+s", "win+r", "alt+f4", "ctrl+shift+esc", or several in order such as "alt+tab enter". Names: ctrl, shift, alt, win, enter, tab, esc, space, backspace, delete, home, end, pageup, pagedown, up, down, left, right, f1-f24, a-z, 0-9, punctuation, volumeup, volumedown, volumemute, playpause; write + as plus.',
    parameters: {
      keys: { type: 'string', required: true, description: 'Chords joined with +, separated by spaces when several are pressed in turn.' },
      repeat: { type: 'number', description: 'Press the whole sequence this many times, 1 to 50 (default 1).' },
      ...focusParameters,
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { keys: string; repeat?: number; window?: number; title?: string }, execution) {
      const chords = parseKeys(args.keys)
      const repeat = Math.round(args.repeat ?? 1)
      if (!Number.isFinite(repeat) || repeat < 1 || repeat > 50) throw new Error('repeat must be between 1 and 50')
      const receiver = await target(args.window, args.title, execution.signal)
      await backend.keys(Array.from({ length: repeat }, () => chords).flat(), execution.signal)
      return { done: `Pressed ${args.keys}${repeat > 1 ? ` x${String(repeat)}` : ''} into ${receiver}` }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_type',
    description: 'Type text with the real keyboard into the focused control of the foreground window. Any characters and languages work; a newline presses Enter. Focus the right field first (click it or pass window or title).',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to type, at most 100000 characters.' },
      paste: { type: 'boolean', description: 'Paste through the clipboard instead of typing key by key: much faster for long text; the earlier clipboard text is restored. Defaults to true above 500 characters.' },
      ...focusParameters,
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { text: string; paste?: boolean; window?: number; title?: string }, execution) {
      if (args.text.length === 0) throw new Error('text is empty')
      if (args.text.length > 100_000) throw new Error('text is longer than 100000 characters; type it in parts')
      const receiver = await target(args.window, args.title, execution.signal)
      const paste = args.paste ?? args.text.length > PASTE_THRESHOLD
      await backend.type(args.text, paste, execution.signal)
      return { done: `${paste ? 'Pasted' : 'Typed'} ${String(args.text.length)} characters into ${receiver}` }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_window',
    description: 'List visible top-level windows and dialogs (handle, process, title, position, foreground); read the text of one (its controls, labels and values, much cheaper than a screenshot); focus, minimize, maximize, restore or close one chosen by handle or title; or wait until a window whose title contains title appears (or, with gone, closes). close asks the app to close and may leave a save prompt open.',
    parameters: {
      action: { type: 'string', required: true, description: 'list, read, focus, minimize, maximize, restore, close or wait.' },
      handle: { type: 'number', description: 'Window handle from list.' },
      title: { type: 'string', description: 'Part of the window title, used when handle is omitted; it must match one window. Required for wait.' },
      gone: { type: 'boolean', description: 'For wait: wait until no window title contains title.' },
      timeout_ms: { type: 'number', description: 'For wait: give up after this many milliseconds, 500 to 60000 (default 15000).' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { action: string; handle?: number; title?: string; gone?: boolean; timeout_ms?: number }, execution) {
      if (args.action === 'wait') return { done: await waitForWindow(backend, args.title, args.gone === true, args.timeout_ms ?? 15_000, execution.signal) }
      const windows = await backend.windows()
      if (args.action === 'list') return { done: windows.length === 0 ? 'No visible windows.' : windows.map(describeWindow).join('\n') }
      if (args.action === 'read') {
        const window = selectWindow(windows, args.handle, args.title)
        const text = (await backend.readText(window.handle)).trimEnd()
        return { done: `Text of ${describeWindow(window)}:\n${text.length > 0 ? text : '(no readable text; capture it with desktop_screenshot)'}` }
      }
      const action = args.action
      if (action !== 'focus' && action !== 'minimize' && action !== 'maximize' && action !== 'restore' && action !== 'close') {
        throw new Error('action must be list, read, focus, minimize, maximize, restore, close or wait')
      }
      const window = selectWindow(windows, args.handle, args.title)
      await backend.window(window.handle, action, execution.signal)
      return { done: await windowOutcome(backend, window, action, execution.signal) }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_open',
    description: 'Open a file, folder, URL, or a system page (on Windows, settings pages such as ms-settings:display or ms-settings:network) with its default app, the way double-clicking it would.',
    parameters: {
      target: { type: 'string', required: true, description: 'Absolute path, URL, or URI such as ms-settings:bluetooth.' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { target: string }) {
      const opened = args.target.trim()
      if (opened.length === 0) throw new Error('target is empty')
      await backend.open(opened)
      return { done: `Opened ${opened}. Use desktop_window list or list_windows to find its window.` }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_sequence',
    description: 'Run several whole-desktop actions in order in one call, stopping at the first failure: open, keys, type, wait, read, focus, minimize, maximize, restore, close, click, drag, scroll, sleep. '
      + 'Use it for steps whose outcome you can predict, such as open an app, wait for its window, focus it, type, and end with read to check the result in the same call. '
      + 'Example: [{"action":"keys","keys":"win+r"},{"action":"wait","title":"Run"},{"action":"type","text":"notepad\\n"},{"action":"wait","title":"Notepad"},{"action":"type","text":"hello"}].',
    parameters: {
      steps: {
        type: 'array',
        required: true,
        description: 'Up to 30 steps. Each takes the same fields as the single-action tool it mirrors.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', required: true, description: 'open, keys, type, wait, read, focus, minimize, maximize, restore, close, click, drag, scroll or sleep.' },
            keys: { type: 'string', description: 'keys: chords such as "ctrl+s" or "alt+tab enter".' },
            text: { type: 'string', description: 'type: text to type; a newline presses Enter.' },
            target: { type: 'string', description: 'open: path, URL or URI.' },
            title: { type: 'string', description: 'wait, read, focus, minimize, maximize, restore, close: part of the window title; keys and type: window to bring forward first.' },
            handle: { type: 'number', description: 'Window handle, instead of title.' },
            gone: { type: 'boolean', description: 'wait: wait for the window to close.' },
            timeout_ms: { type: 'number', description: 'wait: limit in milliseconds (default 15000).' },
            x: { type: 'number', description: 'click, scroll: virtual-desktop x; drag: start x.' },
            y: { type: 'number', description: 'click, scroll: virtual-desktop y; drag: start y.' },
            to_x: { type: 'number', description: 'drag: end x.' },
            to_y: { type: 'number', description: 'drag: end y.' },
            button: { type: 'string', description: 'click, drag: left (default), right or middle.' },
            count: { type: 'number', description: 'click: 1 to 3 clicks.' },
            modifiers: { type: 'string', description: 'click: keys held while clicking, such as ctrl or shift.' },
            paste: { type: 'boolean', description: 'type: paste through the clipboard (default above 500 characters).' },
            direction: { type: 'string', description: 'scroll: up, down, left or right.' },
            amount: { type: 'number', description: 'scroll: notches (default 3).' },
            ms: { type: 'number', description: 'sleep: pause, 50 to 10000 milliseconds.' },
          },
        },
      },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { steps: SequenceStep[] }, execution) {
      if (!Array.isArray(args.steps) || args.steps.length === 0) throw new Error('steps is empty')
      if (args.steps.length > 30) throw new Error('at most 30 steps per sequence')
      const done: string[] = []
      for (const [index, step] of args.steps.entries()) {
        execution.signal.throwIfAborted()
        try {
          done.push(`${String(index + 1)}. ${await runStep(step, execution.signal)}`)
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          const before = done.length > 0 ? `\nCompleted before it:\n${done.join('\n')}` : ''
          throw new Error(`step ${String(index + 1)} (${step.action}) failed: ${reason}${before}`, { cause: error })
        }
      }
      const front = (await backend.windows()).find(window => window.foreground)
      return { done: `${done.join('\n')}\nForeground now: ${front === undefined ? 'the desktop or shell' : describeWindow(front)}` }
    },
  }), options)

  /** One `desktop_sequence` step, validated like the matching single-action tool. */
  async function runStep(step: SequenceStep, signal: AbortSignal): Promise<string> {
    switch (step.action) {
      case 'open': {
        const opened = (step.target ?? '').trim()
        if (opened.length === 0) throw new Error('open needs target')
        await backend.open(opened)
        return `opened ${opened}`
      }
      case 'keys': {
        const chords = parseKeys(step.keys ?? '')
        const receiver = await target(step.handle, step.title, signal)
        await backend.keys(chords, signal)
        return `pressed ${step.keys ?? ''} into ${receiver}`
      }
      case 'type': {
        const text = step.text ?? ''
        if (text.length === 0 || text.length > 100_000) throw new Error('type needs text of 1 to 100000 characters')
        const receiver = await target(step.handle, step.title, signal)
        const paste = step.paste ?? text.length > PASTE_THRESHOLD
        await backend.type(text, paste, signal)
        return `${paste ? 'pasted' : 'typed'} ${String(text.length)} characters into ${receiver}`
      }
      case 'wait':
        return waitForWindow(backend, step.title, step.gone === true, step.timeout_ms ?? 15_000, signal)
      case 'read': {
        const window = selectWindow(await backend.windows(), step.handle, step.title)
        const text = (await backend.readText(window.handle)).trimEnd()
        return `text of "${window.title}":
${text.length > 0 ? text : '(no readable text)'}`
      }
      case 'focus': case 'minimize': case 'maximize': case 'restore': case 'close': {
        const window = selectWindow(await backend.windows(), step.handle, step.title)
        await backend.window(window.handle, step.action, signal)
        return windowOutcome(backend, window, step.action, signal)
      }
      case 'click': {
        const count = step.count ?? 1
        if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('count must be 1, 2 or 3')
        if (step.x === undefined || step.y === undefined) throw new Error('click needs x and y')
        await onDisplay(step.x, step.y)
        const pressed = button(step.button)
        const held = heldKeys(step.modifiers)
        await backend.pointer(step.x, step.y, pressed, count, held, signal)
        return `${held === undefined ? '' : `${held.names.join('+')}+`}${pressed} click x${String(count)} at (${String(step.x)}, ${String(step.y)})`
      }
      case 'drag': {
        if (step.x === undefined || step.y === undefined || step.to_x === undefined || step.to_y === undefined) throw new Error('drag needs x, y, to_x and to_y')
        await onDisplay(step.x, step.y)
        await onDisplay(step.to_x, step.to_y)
        const pressed = button(step.button)
        await backend.drag(step.x, step.y, step.to_x, step.to_y, pressed, signal)
        return `dragged from (${String(step.x)}, ${String(step.y)}) to (${String(step.to_x)}, ${String(step.to_y)})`
      }
      case 'scroll': {
        if (step.x === undefined || step.y === undefined) throw new Error('scroll needs x and y')
        const amount = Math.round(step.amount ?? 3)
        if (!Number.isFinite(amount) || amount < 1 || amount > 50) throw new Error('amount must be between 1 and 50')
        const sign = { up: 1, down: -1, right: 1, left: -1 }[step.direction ?? '']
        if (sign === undefined) throw new Error('direction must be up, down, left or right')
        await onDisplay(step.x, step.y)
        await backend.scroll(step.x, step.y, sign * amount, step.direction === 'left' || step.direction === 'right', signal)
        return `scrolled ${step.direction ?? ''} ${String(amount)} at (${String(step.x)}, ${String(step.y)})`
      }
      case 'sleep': {
        const ms = Math.round(step.ms ?? 500)
        if (!Number.isFinite(ms) || ms < 50 || ms > 10_000) throw new Error('ms must be between 50 and 10000')
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, ms)
          const stop = (): void => { clearTimeout(timer); reject(signal.reason instanceof Error ? signal.reason : new Error('the sequence was cancelled')) }
          signal.addEventListener('abort', stop, { once: true })
        })
        return `waited ${String(ms)} ms`
      }
      default:
        throw new Error(`unknown action "${step.action}"`)
    }
  }
}

/** One step of `desktop_sequence`. */
export interface SequenceStep {
  action: string
  keys?: string
  text?: string
  target?: string
  title?: string
  handle?: number
  gone?: boolean
  timeout_ms?: number
  x?: number
  y?: number
  to_x?: number
  to_y?: number
  button?: string
  count?: number
  modifiers?: string
  paste?: boolean
  direction?: string
  amount?: number
  ms?: number
}
