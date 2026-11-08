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
  /** Press (`down`) or release (`up`) one mouse button at a point and leave it so, for drags and holds over several steps. */
  pressButton(x: number | undefined, y: number | undefined, button: PointerButton, down: boolean, signal?: AbortSignal): Promise<void>
  /** Press (`down`) or release (`up`) the keys of one chord and leave them so. */
  holdKeys(chord: Chord, down: boolean, signal?: AbortSignal): Promise<void>
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
  /** Move and resize one window in virtual-desktop pixels. */
  place(handle: number, x: number, y: number, width: number, height: number, signal?: AbortSignal): Promise<void>
  /** Start an installed app by its name (as in the Start menu or application menu) or by its command; returns what was started. */
  launch(app: string): Promise<string>
  /** Elements of one window by name, type and automation id (numbered lines), where the platform has element access. */
  findElements?(handle: number, query: ElementQuery): Promise<string>
  /** Operate a numbered element; returns its line afterwards, or `CLICK x y` / `TYPE x y` when real input is needed. */
  elementAction?(handle: number, index: number, action: ElementPatternAction, value?: string): Promise<string>
  /** The centre of a numbered element in virtual-desktop pixels. */
  elementPoint?(handle: number, index: number): Promise<{ x: number; y: number }>
  /** Recognize the text shown in one area of the screen, where the platform has text recognition. */
  ocr?(area: CaptureArea): Promise<OcrLine[]>
  /** Recognize the text of one window as it draws itself, even behind others; undefined when it cannot draw itself so. */
  ocrWindow?(window: WindowInfo): Promise<OcrLine[] | undefined>
  /** Capture one window as it draws itself, even behind others; undefined when it cannot draw itself so. */
  captureWindow?(path: string, window: WindowInfo, maxDimension: number): Promise<CaptureResult | undefined>
  /** Stop helper processes. */
  close(): void
}

/** What `desktop_element` looks for in a window. */
export interface ElementQuery {
  /** Visible name or value, matched exactly first, then as a case-insensitive fragment. */
  name?: string | undefined
  /** Control type such as Button, Edit, CheckBox, MenuItem, ListItem or Hyperlink. */
  role?: string | undefined
  /** Automation id of the control. */
  automationId?: string | undefined
}

/** Element operations that go through accessibility patterns rather than real input. */
export type ElementPatternAction = 'invoke' | 'toggle' | 'expand' | 'collapse' | 'select' | 'set_value' | 'focus'

/** One line of recognized screen text in virtual-desktop pixels. */
export interface OcrLine {
  text: string
  x: number
  y: number
  width: number
  height: number
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
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  /** Draw a window, even one behind others, into a device context (PW_RENDERFULLCONTENT). */
  public static bool PrintTo(long handle, IntPtr hdc) { return IsWindow(new IntPtr(handle)) && PrintWindow(new IntPtr(handle), hdc, 2); }
  static string ClassName(IntPtr h) { StringBuilder s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }
  /** Titles for the untitled shell windows a person uses every day. */
  static string ShellName(string className) {
    if (className == "Shell_TrayWnd") return "Taskbar";
    if (className == "Shell_SecondaryTrayWnd") return "Taskbar (other display)";
    if (className == "NotifyIconOverflowWindow" || className == "TopLevelWindowForOverflowXamlIsland") return "Hidden tray icons";
    return "";
  }
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int width, int height, uint flags);
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
  /** Press keys and keep them down (a held modifier, a held game key) until KeysUp. */
  public static void KeysDown(ushort[] keys) {
    List<INPUT> list = new List<INPUT>();
    foreach (ushort vk in keys) list.Add(Key(vk, 0, Ext(vk)));
    Send(list.ToArray());
  }
  /** Release keys pressed with KeysDown, last first. */
  public static void KeysUp(ushort[] keys) {
    List<INPUT> list = new List<INPUT>();
    for (int j = keys.Length - 1; j >= 0; j--) list.Add(Key(keys[j], 0, Ext(keys[j]) | 2u));
    Send(list.ToArray());
  }
  /** Send one mouse button event (down or up) at the pointer. */
  public static void Button(uint flag) { Send(new INPUT[] { Mouse(flag, 0) }); }
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
      // The taskbar and the tray overflow have no title; name them so they can be read and operated like windows.
      if (title.Length == 0) title = ShellName(ClassName(h));
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
  /** Move and resize a window in physical desktop pixels; a minimized or maximized window is restored first. */
  public static void Place(IntPtr h, int x, int y, int width, int height) {
    if (!IsWindow(h)) throw new Exception("no window with handle " + h.ToInt64());
    if (IsIconic(h) || IsZoomed(h)) { ShowWindow(h, 9); Thread.Sleep(150); }
    if (!SetWindowPos(h, IntPtr.Zero, x, y, width, height, 0x0014)) throw new Exception("Windows refused to move the window (error " + Marshal.GetLastWin32Error() + ")");
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
using System.Windows;
using System.Windows.Automation;
namespace HackDev {
public static class Uia {
  static readonly Dictionary<long, List<AutomationElement>> Numbered = new Dictionary<long, List<AutomationElement>>();
  /** Windows in the order they were last read; only the most recent ones keep their numbered elements. */
  static readonly List<long> Recent = new List<long>();
  /** Keep a window's numbered elements, dropping those of the least recently read windows beyond sixteen. */
  static void Remember(long handle, List<AutomationElement> numbered) {
    Numbered[handle] = numbered;
    Recent.Remove(handle);
    Recent.Add(handle);
    while (Recent.Count > 16) { Numbered.Remove(Recent[0]); Recent.RemoveAt(0); }
  }
  static readonly HashSet<string> Controls = new HashSet<string> { "Edit", "Document", "ComboBox", "Button", "CheckBox", "RadioButton", "Slider", "Spinner", "SplitButton", "MenuItem", "TabItem", "ListItem", "TreeItem", "Hyperlink" };
  static string Clean(string text) { return (text ?? "").Replace("\r", " ").Replace("\n", " ").Trim(); }
  static string Quote(string text) { return "\"" + (text.Length > 200 ? text.Substring(0, 200) + "..." : text).Replace("\"", "'") + "\""; }
  /** Centre of an element in physical desktop pixels, or false when it is off screen or has no size. */
  static bool Centre(AutomationElement e, out int x, out int y) {
    x = 0; y = 0;
    try {
      if (e.Current.IsOffscreen) return false;
      Rect r = e.Current.BoundingRectangle;
      if (r.IsEmpty || r.Width <= 0 || r.Height <= 0) return false;
      x = (int)Math.Round(r.X + r.Width / 2); y = (int)Math.Round(r.Y + r.Height / 2);
      return true;
    } catch { return false; }
  }
  static string States(AutomationElement e) {
    List<string> states = new List<string>();
    try {
      if (!e.Current.IsEnabled) states.Add("disabled");
      if (e.Current.HasKeyboardFocus) states.Add("focused");
      object p;
      if (e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) states.Add(((TogglePattern)p).Current.ToggleState == ToggleState.On ? "checked" : ((TogglePattern)p).Current.ToggleState == ToggleState.Off ? "unchecked" : "mixed");
      if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) { ExpandCollapseState s = ((ExpandCollapsePattern)p).Current.ExpandCollapseState; if (s == ExpandCollapseState.Expanded) states.Add("expanded"); else if (s == ExpandCollapseState.Collapsed || s == ExpandCollapseState.PartiallyExpanded) states.Add("collapsed"); }
      if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p) && ((SelectionItemPattern)p).Current.IsSelected) states.Add("selected");
      if (e.TryGetCurrentPattern(ValuePattern.Pattern, out p) && ((ValuePattern)p).Current.IsReadOnly && e.Current.ControlType == ControlType.Edit) states.Add("read-only");
    } catch { }
    return states.Count == 0 ? "" : " (" + string.Join(", ", states.ToArray()) + ")";
  }
  /** One line for an element: type, name, value, centre point and states. */
  static string Describe(AutomationElement e, out bool useful) {
    string name = "", type = "", value = "", automationId = "";
    useful = false;
    try {
      name = Clean(e.Current.Name);
      type = e.Current.ControlType.ProgrammaticName.Replace("ControlType.", "");
      automationId = e.Current.AutomationId ?? "";
      object pattern;
      if (e.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) value = Clean(((ValuePattern)pattern).Current.Value);
    } catch { return ""; }
    useful = name.Length > 0 || value.Length > 0 || Controls.Contains(type);
    StringBuilder line = new StringBuilder(type);
    if (name.Length > 0) line.Append(' ').Append(Quote(name));
    else if (automationId.Length > 0 && Controls.Contains(type)) line.Append(" id=").Append(automationId.Length > 60 ? automationId.Substring(0, 60) : automationId);
    if (value.Length > 0 && value != name) line.Append(" = ").Append(Quote(value));
    int x, y;
    if (Centre(e, out x, out y)) line.Append(" @(").Append(x).Append(',').Append(y).Append(')');
    line.Append(States(e));
    return line.ToString();
  }
  /**
   * The text of one window as numbered lines [n] Type "name" = "value" @(x,y) (states), indented by depth. The
   * numbers stay valid for Act and Find on this window until the next Read of it.
   */
  public static string Read(long handle, int maxItems, int maxChars, int maxMs) {
    AutomationElement root = AutomationElement.FromHandle(new IntPtr(handle));
    TreeWalker walker = TreeWalker.ControlViewWalker;
    StringBuilder text = new StringBuilder();
    List<AutomationElement> numbered = new List<AutomationElement>();
    numbered.Add(null);
    HashSet<string> seen = new HashSet<string>();
    Stopwatch clock = Stopwatch.StartNew();
    Stack<KeyValuePair<AutomationElement, int>> stack = new Stack<KeyValuePair<AutomationElement, int>>();
    stack.Push(new KeyValuePair<AutomationElement, int>(root, 0));
    while (stack.Count > 0 && numbered.Count <= maxItems && text.Length < maxChars && clock.ElapsedMilliseconds < maxMs) {
      KeyValuePair<AutomationElement, int> next = stack.Pop();
      bool useful;
      string line = Describe(next.Key, out useful);
      if (useful && seen.Add(line)) {
        text.Append(new string(' ', Math.Min(next.Value, 8) * 2)).Append('[').Append(numbered.Count).Append("] ").Append(line).Append('\n');
        numbered.Add(next.Key);
      }
      List<AutomationElement> children = new List<AutomationElement>();
      try {
        AutomationElement child = walker.GetFirstChild(next.Key);
        while (child != null && children.Count < 200) { children.Add(child); child = walker.GetNextSibling(child); }
      } catch { }
      for (int i = children.Count - 1; i >= 0; i--) stack.Push(new KeyValuePair<AutomationElement, int>(children[i], next.Value + 1));
    }
    if (stack.Count > 0) text.Append("... more elements were not read\n");
    Remember(handle, numbered);
    return text.ToString();
  }
  /**
   * Find elements of one window by name, control type and automation id, up to 2000 elements and 5 seconds. Exact
   * name matches come first. Each match gets a number for Act. Returns lines [n] description, or "" for none.
   */
  public static string Find(long handle, string name, string role, string automationId, int limit) {
    AutomationElement root = AutomationElement.FromHandle(new IntPtr(handle));
    TreeWalker walker = TreeWalker.ControlViewWalker;
    List<AutomationElement> numbered;
    if (!Numbered.TryGetValue(handle, out numbered)) { numbered = new List<AutomationElement>(); numbered.Add(null); }
    Remember(handle, numbered);
    string needle = Clean(name).ToLowerInvariant();
    string kind = (role ?? "").Trim().ToLowerInvariant();
    string id = (automationId ?? "").Trim();
    List<AutomationElement> exact = new List<AutomationElement>(), partial = new List<AutomationElement>();
    Stopwatch clock = Stopwatch.StartNew();
    Stack<AutomationElement> stack = new Stack<AutomationElement>();
    stack.Push(root);
    int visited = 0;
    while (stack.Count > 0 && visited < 2000 && clock.ElapsedMilliseconds < 5000 && exact.Count < limit) {
      AutomationElement e = stack.Pop(); visited++;
      try {
        string type = e.Current.ControlType.ProgrammaticName.Replace("ControlType.", "").ToLowerInvariant();
        bool typeOk = kind.Length == 0 || type == kind;
        bool idOk = id.Length == 0 || e.Current.AutomationId == id;
        if (typeOk && idOk && e != root) {
          string n = Clean(e.Current.Name).ToLowerInvariant();
          string v = "";
          object pattern;
          if (needle.Length > 0 && n != needle && e.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) v = Clean(((ValuePattern)pattern).Current.Value).ToLowerInvariant();
          if (needle.Length == 0 || n == needle) exact.Add(e);
          else if (n.Contains(needle) || (v.Length > 0 && v.Contains(needle))) partial.Add(e);
        }
      } catch { }
      List<AutomationElement> children = new List<AutomationElement>();
      try {
        AutomationElement child = walker.GetFirstChild(e);
        while (child != null && children.Count < 300) { children.Add(child); child = walker.GetNextSibling(child); }
      } catch { }
      for (int i = children.Count - 1; i >= 0; i--) stack.Push(children[i]);
    }
    exact.AddRange(partial);
    StringBuilder text = new StringBuilder();
    int shown = 0;
    foreach (AutomationElement e in exact) {
      if (shown >= limit) break;
      bool useful;
      string line = Describe(e, out useful);
      if (line.Length == 0) continue;
      int index = numbered.IndexOf(e);
      if (index < 1) { numbered.Add(e); index = numbered.Count - 1; }
      text.Append(shown < exact.Count - partial.Count ? "=" : "~").Append('[').Append(index).Append("] ").Append(line).Append('\n');
      shown++;
    }
    return text.ToString();
  }
  static AutomationElement Element(long handle, int index) {
    List<AutomationElement> numbered;
    if (!Numbered.TryGetValue(handle, out numbered) || index < 1 || index >= numbered.Count || numbered[index] == null)
      throw new Exception("element [" + index + "] is unknown for this window; read the window or find the element first");
    return numbered[index];
  }
  /** The centre of a numbered element as x y, for a real click. */
  public static string Point(long handle, int index) {
    AutomationElement e = Element(handle, index);
    int x, y;
    if (!Centre(e, out x, out y)) throw new Exception("element [" + index + "] is off screen or hidden; scroll it into view or expand its parent first");
    return x + " " + y;
  }
  /**
   * Operate a numbered element through UI Automation: invoke, toggle, expand, collapse, select, set_value, focus.
   * Returns the element's line afterwards, or CLICK x y when the element supports no such pattern and a real
   * click at its centre should be used instead.
   */
  public static string Act(long handle, int index, string action, string value) {
    AutomationElement e = Element(handle, index);
    object p;
    try {
      if (action == "invoke") {
        if (e.TryGetCurrentPattern(InvokePattern.Pattern, out p)) ((InvokePattern)p).Invoke();
        else if (e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) ((TogglePattern)p).Toggle();
        else if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) ((SelectionItemPattern)p).Select();
        else if (e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) ((ExpandCollapsePattern)p).Expand();
        else return "CLICK " + Point(handle, index);
      } else if (action == "toggle") {
        if (e.TryGetCurrentPattern(TogglePattern.Pattern, out p)) ((TogglePattern)p).Toggle(); else return "CLICK " + Point(handle, index);
      } else if (action == "expand" || action == "collapse") {
        if (!e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out p)) return "CLICK " + Point(handle, index);
        if (action == "expand") ((ExpandCollapsePattern)p).Expand(); else ((ExpandCollapsePattern)p).Collapse();
      } else if (action == "select") {
        if (e.TryGetCurrentPattern(SelectionItemPattern.Pattern, out p)) ((SelectionItemPattern)p).Select(); else return "CLICK " + Point(handle, index);
      } else if (action == "set_value") {
        if (e.TryGetCurrentPattern(ValuePattern.Pattern, out p) && !((ValuePattern)p).Current.IsReadOnly) ((ValuePattern)p).SetValue(value ?? "");
        else if (e.TryGetCurrentPattern(RangeValuePattern.Pattern, out p) && !((RangeValuePattern)p).Current.IsReadOnly) ((RangeValuePattern)p).SetValue(double.Parse(value ?? "0", System.Globalization.CultureInfo.InvariantCulture));
        else return "TYPE " + Point(handle, index);
      } else if (action == "focus") {
        e.SetFocus();
      } else throw new Exception("unknown element action " + action);
    } catch (ElementNotAvailableException) {
      throw new Exception("element [" + index + "] no longer exists; read the window again");
    } catch (InvalidOperationException error) {
      throw new Exception("the app refused " + action + " on element [" + index + "] (" + error.Message + "); try a click instead");
    }
    System.Threading.Thread.Sleep(150);
    bool useful;
    string line;
    try { line = Describe(e, out useful); } catch { line = ""; }
    return line.Length == 0 ? "done; the element is gone now (a dialog or menu may have closed)" : line;
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

/**
 * PowerShell that captures one area of the screen and reads its text with the OCR engine built into Windows 10 and
 * 11, printing one tab-separated `x y width height text` line per text line in desktop pixels. Areas up to 1600
 * pixels are enlarged twice first, which helps the engine read small interface text.
 * @param area - the area in virtual-desktop pixels.
 * @returns the script.
 */
export function ocrScript(area: CaptureArea, handle?: number): string {
  const int = (value: number): string => String(Math.round(value))
  const scale = Math.max(area.width, area.height) <= 1600 ? 2 : 1
  return String.raw`if ($null -eq $global:hackdevAsTask) { Add-Type -AssemblyName System.Runtime.WindowsRuntime; `
    + String.raw`$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]; `
    + String.raw`$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]; `
    + String.raw`$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]; `
    + String.raw`$global:hackdevAsTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*' })[0] }; `
    + String.raw`$await = { param($op, [Type]$type) $task = $global:hackdevAsTask.MakeGenericMethod($type).Invoke($null, @($op)); if (-not $task.Wait(15000)) { throw 'text recognition timed out' }; $task.Result }; `
    + String.raw`$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages(); `
    + String.raw`if ($null -eq $engine) { throw 'Windows has no text recognition language: add a language with the Optical character recognition feature in Settings > Time & language > Language & region' }; `
    + `$s = ${String(scale)}; $bx = ${int(area.x)}; $by = ${int(area.y)}; $bw = ${int(area.width)}; $bh = ${int(area.height)}; `
    + (handle === undefined ? SCREEN_CAPTURE : windowCapture(handle))
    + String.raw`if ($s -ne 1) { $big = New-Object System.Drawing.Bitmap(($bw * $s), ($bh * $s)); $bg = [System.Drawing.Graphics]::FromImage($big); `
    + String.raw`$bg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $bg.DrawImage($bmp, 0, 0, $big.Width, $big.Height); $bg.Dispose(); $bmp.Dispose(); $bmp = $big }; `
    + String.raw`$path = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'hackdev-ocr-' + [Guid]::NewGuid().ToString('N') + '.png'); $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); `
    + String.raw`try { $file = & $await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile]); `
    + String.raw`$stream = & $await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream]); `
    + String.raw`try { $decoder = & $await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]); `
    + String.raw`$soft = & $await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap]); `
    + String.raw`$result = & $await ($engine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult]); $soft.Dispose() } finally { $stream.Dispose() } `
    + String.raw`} finally { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }; `
    + String.raw`foreach ($line in $result.Lines) { $l = [double]::MaxValue; $t = [double]::MaxValue; $r = 0.0; $b = 0.0; `
    + String.raw`foreach ($word in $line.Words) { $wr = $word.BoundingRect; $l = [Math]::Min($l, $wr.X); $t = [Math]::Min($t, $wr.Y); $r = [Math]::Max($r, $wr.X + $wr.Width); $b = [Math]::Max($b, $wr.Y + $wr.Height) }; `
    + String.raw`@([int]($bx + $l / $s), [int]($by + $t / $s), [int](($r - $l) / $s), [int](($b - $t) / $s), ($line.Text -replace '\s+', ' ')) -join [char]9 }`
}

/** The last non-empty line of script output. */
function lastLine(out: string): string {
  return out.trim().split(/\r?\n/u).at(-1)?.trim() ?? ''
}

/** Copy the area from the screen into $bmp. */
const SCREEN_CAPTURE = String.raw`$bmp = New-Object System.Drawing.Bitmap($bw, $bh); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($bx, $by, 0, 0, $bmp.Size); $g.Dispose(); `

/**
 * Have one window draw itself into $bmp, so a window behind others is captured as it looks without moving it to the
 * front. A window that cannot draw itself this way (some GPU-rendered apps come out as one flat colour) prints BLANK
 * and ends the script.
 * @param handle - the window.
 * @returns the script fragment.
 */
export function windowCapture(handle: number): string {
  return String.raw`$bmp = New-Object System.Drawing.Bitmap($bw, $bh); $g = [System.Drawing.Graphics]::FromImage($bmp); $hdc = $g.GetHdc(); `
    + `$ok = [HackDev.Desk]::PrintTo(${String(Math.trunc(handle))}, $hdc); `
    + String.raw`$g.ReleaseHdc($hdc); $g.Dispose(); $first = $bmp.GetPixel(0, 0).ToArgb(); $flat = $true; `
    + String.raw`for ($i = 1; $i -le 12 -and $flat; $i++) { for ($j = 1; $j -le 12; $j++) { `
    + String.raw`if ($bmp.GetPixel([int]($bw * $i / 13), [int]($bh * $j / 13)).ToArgb() -ne $first) { $flat = $false; break } } }; `
    + String.raw`if (-not $ok -or $flat) { $bmp.Dispose(); 'BLANK'; return }; `
}

/**
 * Parse tab-separated OCR lines: x, y, width, height, text.
 * @param out - script output.
 * @returns the lines with text.
 */
export function parseOcrLines(out: string): OcrLine[] {
  const lines: OcrLine[] = []
  for (const row of out.split(/\r?\n/u)) {
    const [x, y, width, height, ...rest] = row.split('\t')
    const text = rest.join(' ').trim()
    if (text.length === 0 || x === undefined || y === undefined || width === undefined || height === undefined) continue
    const numbers = [x, y, width, height].map(Number)
    if (numbers.some(value => !Number.isFinite(value))) continue
    lines.push({ text, x: numbers[0] ?? 0, y: numbers[1] ?? 0, width: numbers[2] ?? 0, height: numbers[3] ?? 0 })
  }
  return lines
}

/**
 * Group `tesseract ... tsv` word rows into lines in desktop pixels.
 * @param tsv - tesseract TSV output (level, page, block, paragraph, line, word, left, top, width, height, conf, text).
 * @param originX - desktop x of the image's left edge.
 * @param originY - desktop y of the image's top edge.
 * @returns the recognized lines in reading order.
 */
export function parseTesseractTsv(tsv: string, originX: number, originY: number): OcrLine[] {
  const lines = new Map<string, { words: string[]; left: number; top: number; right: number; bottom: number }>()
  for (const row of tsv.split(/\r?\n/u).slice(1)) {
    const cells = row.split('\t')
    if (cells.length < 12 || cells[0] !== '5') continue
    const text = (cells.slice(11).join(' ')).trim()
    if (text.length === 0 || Number(cells[10]) < 0) continue
    const [left, top, width, height] = cells.slice(6, 10).map(Number)
    if (left === undefined || top === undefined || width === undefined || height === undefined) continue
    const key = cells.slice(1, 5).join('.')
    const line = lines.get(key)
    if (line === undefined) lines.set(key, { words: [text], left, top, right: left + width, bottom: top + height })
    else {
      line.words.push(text)
      line.left = Math.min(line.left, left)
      line.top = Math.min(line.top, top)
      line.right = Math.max(line.right, left + width)
      line.bottom = Math.max(line.bottom, top + height)
    }
  }
  return [...lines.values()].map(line => ({
    text: line.words.join(' '), x: originX + line.left, y: originY + line.top, width: line.right - line.left, height: line.bottom - line.top,
  }))
}

/**
 * PowerShell that starts an installed app by its Start-menu name (exact, then prefix, then fragment, shortest name
 * first), or else runs the name as a command such as `notepad` or `winword`, and prints what it started.
 * @param app - app name or command.
 * @returns the script.
 */
export function launchScript(app: string): string {
  return `$q = ${psQuote(app.trim())}; $all = @(); try { $all = @(Get-StartApps) } catch { }; `
    + '$m = @($all | Where-Object { $_.Name -eq $q }); '
    + 'if ($m.Count -eq 0) { $m = @($all | Where-Object { $_.Name -like ($q + \'*\') } | Sort-Object { $_.Name.Length }) }; '
    + 'if ($m.Count -eq 0) { $m = @($all | Where-Object { $_.Name -like (\'*\' + $q + \'*\') } | Sort-Object { $_.Name.Length }) }; '
    + 'if ($m.Count -gt 0) { Start-Process -FilePath (\'shell:AppsFolder\\\' + $m[0].AppID); \'Started \' + $m[0].Name + \' from the Start menu\' } '
    + 'else { try { Start-Process -FilePath $q -ErrorAction Stop; \'Started the command \' + $q } catch { '
    + '$near = @($all | Where-Object { $n = $_.Name; @($q -split \'\\s+\' | Where-Object { $_.Length -gt 2 -and $n -like (\'*\' + $_ + \'*\') }).Count -gt 0 } | Select-Object -First 8 -ExpandProperty Name); '
    + 'throw (\'no installed app is named like "\' + $q + \'" and it is not a command\' + $(if ($near.Count -gt 0) { \'; similar apps: \' + ($near -join \', \') } else { \'; check the name in the Start menu\' })) } }'
}

/** Every monitor as JSON, read fresh from Windows: device name, whether primary, and bounds in physical pixels. */
const LIST_SCREENS = '@([HackDev.Desk]::Monitors()) | ConvertTo-Json -Compress'

/** Quote a value for a single-quoted PowerShell string. */
export function psQuote(value: string): string {
  // PowerShell also ends a single-quoted string at the curly single quotes U+2018 to U+201B, so each is doubled too;
  // otherwise text such as "don’t" from a web page would close the string and run the rest as code.
  return `'${value.replace(/['‘’‚‛]/gu, quote => quote + quote)}'`
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
    async pressButton(x, y, pressed, down, signal) {
      const [downFlag, upFlag] = BUTTON_FLAGS[pressed]
      const flag = { op: 'button' as const, flag: down ? downFlag : upFlag }
      // Without a point the button changes where the pointer already is.
      if (x === undefined || y === undefined) await input([flag], undefined, signal)
      else await input([{ op: 'move', x, y }, { op: 'sleep', ms: 40 }, flag], { x, y }, signal)
    },
    async holdKeys(chord, down, signal) {
      await input([{ op: down ? 'keys-down' : 'keys-up', vks: chord.vk }], undefined, signal)
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
      return ps(`${UIA_CHECK}[HackDev.Uia]::Read(${int(handle)}, 300, 8000, 4000)`)
    },
    async place(handle, x, y, width, height, signal) {
      await input([{ op: 'place', handle, x, y, width, height }], { handle }, signal)
    },
    async launch(app) {
      return ps(launchScript(app), 20_000)
    },
    async findElements(handle, query) {
      return ps(`${UIA_CHECK}[HackDev.Uia]::Find(${int(handle)}, ${psQuote(query.name ?? '')}, ${psQuote(query.role ?? '')}, ${psQuote(query.automationId ?? '')}, 15)`, 15_000)
    },
    async elementAction(handle, index, action, value) {
      return ps(`${UIA_CHECK}[HackDev.Uia]::Act(${int(handle)}, ${int(index)}, '${action}', ${psQuote(value ?? '')})`, 15_000)
    },
    async elementPoint(handle, index) {
      const [x, y] = (await ps(`${UIA_CHECK}[HackDev.Uia]::Point(${int(handle)}, ${int(index)})`)).trim().split(/\s+/u).map(Number)
      if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`element [${String(index)}] has no position on screen`)
      return { x, y }
    },
    async ocr(area) {
      return parseOcrLines(await ps(ocrScript(area), 30_000))
    },
    async ocrWindow(window) {
      const out = await ps(ocrScript(window, window.handle), 30_000)
      return lastLine(out) === 'BLANK' ? undefined : parseOcrLines(out)
    },
    async captureWindow(path, window, maxDimension) {
      const out = await ps(`$bw = ${int(window.width)}; $bh = ${int(window.height)}; ${windowCapture(window.handle)}`
        + `$s = [Math]::Min(1.0, ${int(maxDimension)} / [double][Math]::Max($bw, $bh)); $w = [int][Math]::Round($bw * $s); $h = [int][Math]::Round($bh * $s); `
        + 'if ($s -lt 1.0) { $small = New-Object System.Drawing.Bitmap($w, $h); $sg = [System.Drawing.Graphics]::FromImage($small); '
        + '$sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; $sg.DrawImage($bmp, 0, 0, $w, $h); $sg.Dispose(); $bmp.Dispose(); $bmp = $small }; '
        + `$bmp.Save(${psQuote(path)}, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); "$w $h $s"`)
      const last = lastLine(out)
      if (last === 'BLANK') return undefined
      // Only the last line is the size; drawing calls can print before it.
      const [width, height, scale] = last.split(/\s+/u).map(Number)
      return { width: width ?? 0, height: height ?? 0, scale: scale ?? 1 }
    },
    close() {
      elevated?.close()
      host?.close()
    },
  }
}

/** Script prefix that fails with a readable message where UI Automation could not be loaded. */
const UIA_CHECK = "if (-not ('HackDev.Uia' -as [type])) { throw 'UI Automation is not available on this system' }; "

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
 * xdotool arguments for a drag that moves in steps like a hand, so drop targets see the pointer travel.
 * @param fromX - start x.
 * @param fromY - start y.
 * @param toX - end x.
 * @param toY - end y.
 * @param button - X11 button number.
 * @returns the arguments.
 */
export function linuxDragArgs(fromX: number, fromY: number, toX: number, toY: number, button: string): string[] {
  const steps = Math.max(8, Math.min(40, Math.round((Math.abs(toX - fromX) + Math.abs(toY - fromY)) / 25)))
  const path: string[] = []
  for (let step = 1; step <= steps; step++) {
    path.push('mousemove', String(Math.round(fromX + (toX - fromX) * step / steps)), String(Math.round(fromY + (toY - fromY) * step / steps)), 'sleep', '0.012')
  }
  return ['mousemove', '--sync', String(Math.round(fromX)), String(Math.round(fromY)), 'mousedown', button, 'sleep', '0.06', ...path, 'sleep', '0.08', 'mouseup', button]
}

/** Shell script that pastes $1 through the clipboard and restores the earlier clipboard text; prints PASTED. */
export const LINUX_PASTE = 'command -v xclip >/dev/null 2>&1 || exit 3; '
  + 'old=$(xclip -o -selection clipboard 2>/dev/null); had=$?; '
  + 'printf %s "$1" | xclip -selection clipboard || exit 4; '
  + 'xdotool key --clearmodifiers ctrl+v; sleep 0.6; '
  + 'if [ "$had" = 0 ]; then printf %s "$old" | xclip -selection clipboard; fi; echo PASTED'

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
      await helper('xdotool', linuxDragArgs(fromX, fromY, toX, toY, X11_BUTTONS[button]), signal)
    },
    async scroll(x, y, clicks, horizontal, signal) {
      const wheel = horizontal ? (clicks > 0 ? '7' : '6') : (clicks > 0 ? '4' : '5')
      await helper('xdotool', ['mousemove', '--sync', int(x), int(y), 'click', '--repeat', String(Math.abs(Math.round(clicks))), wheel], signal)
    },
    async keys(chords, signal) {
      await helper('xdotool', ['key', '--clearmodifiers', ...chords.map(chord => chord.x11)], signal)
    },
    async pressButton(x, y, pressed, down, signal) {
      const move = x === undefined || y === undefined ? [] : ['mousemove', '--sync', int(x), int(y)]
      await helper('xdotool', [...move, down ? 'mousedown' : 'mouseup', X11_BUTTONS[pressed]], signal)
    },
    async holdKeys(chord, down, signal) {
      await helper('xdotool', [down ? 'keydown' : 'keyup', chord.x11], signal)
    },
    async type(text, paste, signal) {
      // Long text goes through the clipboard (xclip), putting the earlier clipboard text back; without xclip it is typed.
      if (paste === true) {
        const pasted = await run('sh', ['-c', LINUX_PASTE, 'sh', text], 30_000).then(out => out.trim() === 'PASTED', () => false)
        if (pasted) return
      }
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
    async place(handle, x, y, width, height, signal) {
      const id = hex(handle)
      await helper('wmctrl', ['-ir', id, '-b', 'remove,maximized_vert,maximized_horz'], signal)
      await helper('wmctrl', ['-ir', id, '-e', `0,${int(x)},${int(y)},${int(width)},${int(height)}`], signal)
    },
    async launch(app) {
      const name = app.trim()
      // A command on PATH starts detached from this process; anything else is tried as a desktop entry id.
      await run('sh', ['-c', 'if command -v "$1" >/dev/null 2>&1; then setsid -f "$1" >/dev/null 2>&1; else gtk-launch "$1"; fi', 'sh', name])
        .catch((error: unknown) => {
          throw new Error(`could not start "${name}": ${String(error instanceof Error ? error.message : error)}. Pass the command name or the .desktop id of the app`, { cause: error })
        })
      return `Started ${name}`
    },
    async ocr(area) {
      const file = join(await mkdtemp(join(tmpdir(), 'hackdev-ocr-')), 'area.png')
      try {
        const offset = (value: number): string => (Math.round(value) < 0 ? '' : '+') + int(value)
        await helper('import', ['-window', 'root', '-crop', `${int(area.width)}x${int(area.height)}${offset(area.x)}${offset(area.y)}`, file])
        const tsv = await run('tesseract', [file, '-', 'tsv']).catch((error: unknown) => {
          throw new Error(`${String(error instanceof Error ? error.message : error)}. Reading text from the screen uses tesseract: install it with sudo apt-get install -y tesseract-ocr`, { cause: error })
        })
        return parseTesseractTsv(tsv, area.x, area.y)
      } finally {
        await rm(join(file, '..'), { recursive: true, force: true }).catch(() => {})
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
  let matches = windows.filter(window => window.title.toLowerCase().includes(needle))
  // A process name such as "notepad" or "chrome" also finds the app's window when no title contains it.
  if (matches.length === 0) matches = windows.filter(window => window.process.toLowerCase().replace(/\.exe$/u, '') === needle.replace(/\.exe$/u, ''))
  const exact = matches.filter(window => window.title.toLowerCase() === needle)
  if (exact.length === 1 && exact[0] !== undefined) return exact[0]
  if (matches.length === 1 && matches[0] !== undefined) return matches[0]
  if (matches.length === 0) throw new Error(`no window title contains "${title}"; open windows:\n${windowList(windows)}`)
  throw new Error(`${String(matches.length)} windows match "${title}"; pass handle:\n${windowList(matches)}`)
}

/** Window lines for an error message, at most 15 so a crowded desktop does not flood the model. */
function windowList(windows: readonly WindowInfo[]): string {
  const shown = windows.slice(0, 15).map(describeWindow).join('\n')
  return windows.length > 15 ? `${shown}\n... and ${String(windows.length - 15)} more; call desktop_window with action list` : shown
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
 * Poll a window's text until it contains `text`, or until it no longer does when `gone`: a page finished loading,
 * a status reads "Done", an error message appeared or a spinner's label went away.
 * @param read - reads the window's current text.
 * @param text - text to look for, compared case-insensitively with runs of white space treated as one space.
 * @param gone - wait for the text to disappear instead.
 * @param timeoutMs - limit, 500 to 60000 milliseconds.
 * @param signal - cancels the wait.
 * @param intervalMs - polling interval.
 * @returns a description of the outcome.
 * @throws when the limit passes first.
 */
export async function waitForText(
  read: () => Promise<string>, text: string | undefined, gone: boolean, timeoutMs: number, signal?: AbortSignal, intervalMs = 400,
): Promise<string> {
  const squash = (value: string): string => value.replace(/\s+/gu, ' ').trim().toLowerCase()
  const needle = squash(text ?? '')
  if (needle.length === 0) throw new Error('wait for text needs text')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 60_000) throw new Error('timeout_ms must be between 500 and 60000')
  const started = Date.now()
  for (;;) {
    signal?.throwIfAborted()
    const found = squash(await read()).includes(needle)
    const waited = Date.now() - started
    if (found !== gone) return `${gone ? 'The text is gone' : 'Found the text'} "${text ?? ''}" after ${String(waited)} ms.`
    if (waited >= timeoutMs) {
      throw new Error(gone ? `"${text ?? ''}" was still shown after ${String(timeoutMs)} ms` : `"${text ?? ''}" did not appear within ${String(timeoutMs)} ms; read the window to see what it shows instead`)
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

/**
 * Recognized text as numbered lines with the centre point of each, ready for a click, bounded in size.
 * @param lines - recognized lines.
 * @returns the text for the model.
 */
export function formatOcr(lines: readonly OcrLine[]): string {
  const out: string[] = []
  let size = 0
  for (const [index, line] of lines.entries()) {
    const row = `[${String(index + 1)}] "${line.text.length > 200 ? `${line.text.slice(0, 200)}...` : line.text}" @(${String(Math.round(line.x + line.width / 2))},${String(Math.round(line.y + line.height / 2))})`
    if (out.length >= 250 || size + row.length > 9000) {
      out.push(`... ${String(lines.length - index)} more lines; capture a smaller area to read them`)
      break
    }
    out.push(row)
    size += row.length + 1
  }
  return out.join('\n')
}

/**
 * The recognized line that best matches a label: the exact text first, then the shortest line containing it.
 * @param lines - recognized lines.
 * @param label - the visible text to find.
 * @returns the line, or undefined.
 */
export function findOcrLine(lines: readonly OcrLine[], label: string): OcrLine | undefined {
  const squash = (value: string): string => value.replace(/\s+/gu, ' ').trim().toLowerCase()
  const needle = squash(label)
  if (needle.length === 0) return undefined
  return lines.find(line => squash(line.text) === needle)
    ?? lines.filter(line => squash(line.text).includes(needle)).toSorted((a, b) => a.text.length - b.text.length)[0]
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
- Long text: desktop_type pastes through the clipboard above 500 characters (and restores the clipboard), which is far faster than typing. Hold keys during a click with modifiers, such as ctrl to add to a selection.
- Work like a person who reads the screen: desktop_window read numbers every control as [n] with its centre point @(x,y) and state. desktop_element acts on a control by that number or by its visible name ("Save", "OK", "File name"): click, invoke, toggle, expand, select or set_value, without guessing coordinates. When a window exposes no controls (games, remote desktops, canvases, images), desktop_ocr reads the text on screen with the centre point of each line, and desktop_element click by name falls back to it.
- Start apps by name with desktop_open app ("Calculator", "Word", "Visual Studio Code"); it reports the window that appeared. Wait for a result instead of sleeping: desktop_window wait with text waits until the window shows that text (a page loaded, "Done", an error).
- If you cannot see images, never guess coordinates: use read, desktop_element and desktop_ocr, which give exact points.
- File dialogs: focus the dialog, press alt+n (or click the "File name" box), type the full path, press enter, then wait for the dialog to close.`

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
  /** Buttons and chords left pressed by press down or hold down; released when these tools are unloaded. */
  const heldButtons = new Set<PointerButton>()
  const heldChords = new Map<string, Chord>()
  ctx.effect(() => () => {
    for (const chord of heldChords.values()) void backend.holdKeys(chord, false).catch(() => {})
    for (const which of heldButtons) void backend.pressButton(undefined, undefined, which, false).catch(() => {})
    heldChords.clear()
    heldButtons.clear()
  }, 'desktop.held-input')
  /** How points in the latest desktop_screenshot image map to the desktop, for image_x and image_y. */
  let lastCapture: { originX: number; originY: number; scale: number; width: number; height: number } | undefined
  /** A desktop point from x and y, or from image_x and image_y in the latest screenshot. */
  const point = (args: { x?: number; y?: number; image_x?: number; image_y?: number }): { x: number; y: number } => {
    if (args.image_x !== undefined || args.image_y !== undefined) {
      if (args.image_x === undefined || args.image_y === undefined) throw new Error('pass both image_x and image_y')
      if (lastCapture === undefined) throw new Error('image_x and image_y refer to the latest desktop_screenshot, and none was taken yet')
      if (args.image_x < 0 || args.image_y < 0 || args.image_x > lastCapture.width || args.image_y > lastCapture.height) {
        throw new Error(`(${String(args.image_x)}, ${String(args.image_y)}) is outside the latest screenshot, which is ${String(lastCapture.width)}x${String(lastCapture.height)}`)
      }
      return {
        x: Math.round(lastCapture.originX + args.image_x / lastCapture.scale),
        y: Math.round(lastCapture.originY + args.image_y / lastCapture.scale),
      }
    }
    if (args.x === undefined || args.y === undefined) throw new Error('pass x and y (desktop pixels), or image_x and image_y (a point in the latest screenshot)')
    return { x: args.x, y: args.y }
  }
  /** The window chosen by handle or title, or the foreground window when neither is given. */
  const chosenWindow = async (handle?: number, title?: string): Promise<WindowInfo> => {
    const windows = await backend.windows()
    if (handle !== undefined || title !== undefined) return selectWindow(windows, handle, title)
    const front = windows.find(window => window.foreground)
    if (front === undefined) throw new Error('no window has focus; pass window or title')
    return front
  }
  /** Recognize the text of one window, bringing it to the front first so what is read is the window itself. */
  const windowOcr = async (window: WindowInfo, signal?: AbortSignal): Promise<OcrLine[]> => {
    if (backend.ocr === undefined) throw new Error('reading text from the screen is not available on this platform')
    // A window behind others is read as it draws itself, without taking the person's focus.
    if (!window.foreground && !window.minimized && backend.ocrWindow !== undefined) {
      const drawn = await backend.ocrWindow(window)
      if (drawn !== undefined) return drawn
    }
    if (window.minimized) await backend.window(window.handle, 'restore', signal)
    if (!window.foreground || window.minimized) await backend.window(window.handle, 'focus', signal)
    const fresh = (await backend.windows()).find(candidate => candidate.handle === window.handle) ?? window
    return backend.ocr(fresh)
  }
  /** A window's controls and text; when it exposes none, the text recognized on screen instead. */
  const windowText = async (window: WindowInfo, signal?: AbortSignal): Promise<string> => {
    const text = (await backend.readText(window.handle).catch((error: unknown) => {
      if (backend.ocr === undefined) throw error
      return ''
    })).trimEnd()
    if (text.split('\n').filter(line => line.trim().length > 0).length >= 3 || backend.ocr === undefined) return text
    const lines = await windowOcr(window, signal).catch(() => [])
    if (lines.length === 0) return text
    return `${text.length > 0 ? `${text}\n` : ''}The window exposes few controls; text recognized on screen (centre points for desktop_pointer):\n${formatOcr(lines)}`
  }
  /** Move and resize a window, keeping its size or position where none is given, and report where it ended up. */
  const moveWindow = async (window: WindowInfo, to: Partial<CaptureArea>, signal?: AbortSignal): Promise<string> => {
    const width = Math.round(to.width ?? window.width)
    const height = Math.round(to.height ?? window.height)
    if (width < 50 || height < 30) throw new Error('width must be at least 50 and height at least 30')
    if (to.x === undefined && to.y === undefined && to.width === undefined && to.height === undefined) throw new Error('move needs x and y, width and height, or both')
    const x = Math.round(to.x ?? window.x)
    const y = Math.round(to.y ?? window.y)
    await onDisplay(x + Math.min(40, width - 1), y + Math.min(10, height - 1))
    await backend.place(window.handle, x, y, width, height, signal)
    const now = (await backend.windows()).find(candidate => candidate.handle === window.handle)
    if (now === undefined) return `Moved "${window.title}", which then closed.`
    const kept = Math.abs(now.width - width) > 24 || Math.abs(now.height - height) > 24
      ? ` The app kept ${String(now.width)}x${String(now.height)} instead of ${String(width)}x${String(height)}; it may have a minimum or fixed size.`
      : ''
    return `Moved; now ${describeWindow(now)}.${kept}`
  }
  /** Start an app by name and report the window it opened. */
  const launchApp = async (app: string, signal?: AbortSignal): Promise<string> => {
    const name = app.trim()
    if (name.length === 0) throw new Error('app is empty')
    const before = new Set((await backend.windows()).map(window => window.handle))
    const started = await backend.launch(name)
    const words = name.toLowerCase().split(/\s+/u).filter(word => word.length > 2)
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      await new Promise(resolve => setTimeout(resolve, 400))
      const fresh = (await backend.windows()).filter(window => !before.has(window.handle))
      const likely = fresh.find(window => words.some(word => `${window.title} ${window.process}`.toLowerCase().includes(word))) ?? fresh[0]
      if (likely !== undefined) return `${started}. New window: ${describeWindow(likely)}`
    }
    const existing = (await backend.windows()).filter(window => words.some(word => `${window.title} ${window.process}`.toLowerCase().includes(word)))
    return `${started}, but no new window appeared within 10 s; it may still be loading, or it reused an open window.`
      + (existing.length > 0 ? ` Matching windows: ${existing.slice(0, 5).map(describeWindow).join('; ')}` : ' Wait for it with desktop_window wait.')
  }

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
        x: { type: 'number', description: 'Capture only this region instead: its left edge in virtual-desktop pixels (with y, width and height). Zoom into a small area this way.' },
        y: { type: 'number', description: 'Region top edge.' },
        width: { type: 'number', description: 'Region width.' },
        height: { type: 'number', description: 'Region height.' },
        max_dimension: { type: 'number', description: 'Longest side of the image in pixels (default 1280, 200 to 4096).' },
        ocr: { type: 'boolean', description: 'Also return the text recognized in the captured area with the centre point of each line.' },
      },
    },
    async call(raw) {
      const args = raw as AreaArgs & { max_dimension?: number; ocr?: boolean }
      const maxDimension = Math.round(args.max_dimension ?? 1280)
      if (!Number.isFinite(maxDimension) || maxDimension < 200 || maxDimension > 4096) throw new Error('max_dimension must be between 200 and 4096')
      const displays = await backend.list()
      let area: CaptureArea | undefined
      let captured: WindowInfo | undefined
      let label: string
      if (args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined) {
        if (args.x === undefined || args.y === undefined || args.width === undefined || args.height === undefined) throw new Error('a region needs x, y, width and height')
        if (args.width < 8 || args.height < 8) throw new Error('a region must be at least 8 pixels wide and high')
        area = { x: args.x, y: args.y, width: args.width, height: args.height }
        label = `region ${String(args.width)}x${String(args.height)} at (${String(args.x)}, ${String(args.y)})`
      } else if (args.window !== undefined || args.title !== undefined) {
        const window = selectWindow(await backend.windows(), args.window, args.title)
        if (window.minimized) throw new Error(`"${window.title}" is minimized; restore it before capturing it`)
        area = window
        captured = window
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
        // A window behind others is captured as it draws itself; the screen copy would show what covers it.
        const drawn = captured !== undefined && !captured.foreground && backend.captureWindow !== undefined
          ? await backend.captureWindow(path, captured, maxDimension)
          : undefined
        size = drawn ?? await backend.capture(path, area, maxDimension)
        data = (await readFile(path)).toString('base64')
      } finally {
        await rm(directory, { recursive: true, force: true }).catch(() => {})
      }
      const originX = area?.x ?? Math.min(0, ...displays.map(d => d.x))
      const originY = area?.y ?? Math.min(0, ...displays.map(d => d.y))
      const mapping = size.scale === 1
        ? `desktop x = ${String(originX)} + image x, desktop y = ${String(originY)} + image y`
        : `desktop x = ${String(originX)} + image x / ${size.scale.toFixed(4)}, desktop y = ${String(originY)} + image y / ${size.scale.toFixed(4)}`
      lastCapture = { originX, originY, scale: size.scale, width: size.width, height: size.height }
      let text = `${label}, image ${String(size.width)}x${String(size.height)}. To act on a point in this image: ${mapping}, `
        + 'or pass the image point as image_x and image_y to desktop_pointer and it is converted for you.'
      if (args.ocr === true) {
        const whole = area ?? displays.reduce<CaptureArea>((all, next) => ({
          x: Math.min(all.x, next.x), y: Math.min(all.y, next.y),
          width: Math.max(all.x + all.width, next.x + next.width) - Math.min(all.x, next.x),
          height: Math.max(all.y + all.height, next.y + next.height) - Math.min(all.y, next.y),
        }), displays[0] ?? { x: 0, y: 0, width: 0, height: 0 })
        const lines = backend.ocr === undefined ? [] : await backend.ocr(whole)
        text += `\nText on screen (desktop centre points):\n${lines.length > 0 ? formatOcr(lines) : '(none recognized)'}`
      }
      return { content: [{ type: 'text', text }, { type: 'image', data, mimeType: 'image/png' }] }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_pointer',
    description: 'Move the real mouse pointer to virtual-desktop coordinates on any display and optionally click. Coordinates of a display start at its x and y from desktop_list_displays.',
    parameters: {
      x: { type: 'number', description: 'Virtual-desktop x in pixels (from read, desktop_element or desktop_ocr centre points).' },
      y: { type: 'number', description: 'Virtual-desktop y in pixels.' },
      image_x: { type: 'number', description: 'Instead of x and y: x of a point in the latest desktop_screenshot image; it is converted to the desktop.' },
      image_y: { type: 'number', description: 'y of that point in the latest screenshot image.' },
      button: { type: 'string', description: 'left (default), right, middle, or none to move only (hover).' },
      count: { type: 'number', description: 'Clicks to send: 1 (default), 2 for a double-click, 3 for a triple-click.' },
      modifiers: { type: 'string', description: 'Keys held while clicking, such as ctrl (add to a selection), shift (extend it) or ctrl+shift.' },
      press: { type: 'string', description: 'Instead of a click: down presses the button at the point and keeps it down; up releases it there. Use for drags over several steps, drawing, or long presses.' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: PointArgs & { button?: string; count?: number; modifiers?: string; press?: string }, execution) {
      if (args.press !== undefined) {
        if (args.press !== 'down' && args.press !== 'up') throw new Error('press must be down or up')
        const which = button(args.button)
        const at = point(args)
        await onDisplay(at.x, at.y)
        await backend.pressButton(at.x, at.y, which, args.press === 'down', execution.signal)
        if (args.press === 'down') heldButtons.add(which)
        else heldButtons.delete(which)
        return { done: args.press === 'down'
          ? `Pressed and holding the ${which} button at (${String(at.x)}, ${String(at.y)}); release it with press up.`
          : `Released the ${which} button at (${String(at.x)}, ${String(at.y)}).` }
      }
      const pressed = args.button === 'none' ? 'none' : button(args.button)
      const count = args.count ?? 1
      if (!Number.isInteger(count) || count < 1 || count > 3) throw new Error('count must be 1, 2 or 3')
      const { x, y } = point(args)
      const on = await onDisplay(x, y)
      const held = heldKeys(args.modifiers)
      await backend.pointer(x, y, pressed, count, held, execution.signal)
      const how = pressed === 'none' ? 'Moved to' : `${held === undefined ? '' : `${held.names.join('+')}+`}${pressed} click x${String(count)} at`
      return { done: `${how} (${String(x)}, ${String(y)}) on display ${describe(on)}` }
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
      hold: { type: 'string', description: 'Instead of pressing and releasing: down presses one chord and keeps it down (such as shift for a series of clicks); up releases it.' },
      ...focusParameters,
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { keys: string; repeat?: number; hold?: string; window?: number; title?: string }, execution) {
      const chords = parseKeys(args.keys)
      if (args.hold !== undefined) {
        if (args.hold !== 'down' && args.hold !== 'up') throw new Error('hold must be down or up')
        const chord = chords[0]
        if (chords.length !== 1 || chord === undefined) throw new Error('hold takes one chord, such as shift or ctrl+alt')
        const receiver = await target(args.window, args.title, execution.signal)
        await backend.holdKeys(chord, args.hold === 'down', execution.signal)
        const name = chord.names.join('+')
        if (args.hold === 'down') heldChords.set(name, chord)
        else heldChords.delete(name)
        return { done: args.hold === 'down' ? `Holding ${name} down in ${receiver}; release it with hold up.` : `Released ${name}.` }
      }
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
    description: 'List visible top-level windows and dialogs (handle, process, title, position, foreground); read one window (every control numbered [n] with its type, name, value, centre point @(x,y) and state; far cheaper than a screenshot); '
      + 'focus, minimize, maximize, restore, close or move (position and size) one chosen by handle, title or process name; or wait until a window whose title contains title appears (or, with gone, closes), or, with text, until a window shows that text. '
      + 'close asks the app to close and may leave a save prompt open.',
    parameters: {
      action: { type: 'string', required: true, description: 'list, read, focus, minimize, maximize, restore, close, move or wait.' },
      handle: { type: 'number', description: 'Window handle from list.' },
      title: { type: 'string', description: 'Part of the window title (or the process name, such as notepad), used when handle is omitted. For wait without text: the title to wait for.' },
      text: { type: 'string', description: 'For wait: wait until the window (handle or title, else the foreground window) shows this text; with gone, until it no longer does.' },
      gone: { type: 'boolean', description: 'For wait: wait until the window (or the text) is gone.' },
      timeout_ms: { type: 'number', description: 'For wait: give up after this many milliseconds, 500 to 60000 (default 15000).' },
      x: { type: 'number', description: 'For move: new left edge in virtual-desktop pixels.' },
      y: { type: 'number', description: 'For move: new top edge.' },
      width: { type: 'number', description: 'For move: new width (default: unchanged).' },
      height: { type: 'number', description: 'For move: new height (default: unchanged).' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: WindowArgs, execution) {
      if (args.action === 'wait') {
        const timeout = args.timeout_ms ?? 15_000
        const gone = args.gone === true
        if (args.text === undefined) return { done: await waitForWindow(backend, args.title, gone, timeout, execution.signal) }
        const window = await chosenWindow(args.handle, args.title)
        return { done: await waitForText(() => windowText(window, execution.signal), args.text, gone, timeout, execution.signal) }
      }
      const windows = await backend.windows()
      if (args.action === 'list') return { done: windows.length === 0 ? 'No visible windows.' : windows.map(describeWindow).join('\n') }
      if (args.action === 'read') {
        const window = args.handle === undefined && args.title === undefined
          ? await chosenWindow()
          : selectWindow(windows, args.handle, args.title)
        const text = await windowText(window, execution.signal)
        return { done: `Text of ${describeWindow(window)}:\n${text.length > 0 ? text : '(no readable text; capture it with desktop_screenshot)'}` }
      }
      if (args.action === 'move') {
        const window = selectWindow(windows, args.handle, args.title)
        return { done: await moveWindow(window, args, execution.signal) }
      }
      const action = args.action
      if (action !== 'focus' && action !== 'minimize' && action !== 'maximize' && action !== 'restore' && action !== 'close') {
        throw new Error('action must be list, read, focus, minimize, maximize, restore, close, move or wait')
      }
      const window = selectWindow(windows, args.handle, args.title)
      await backend.window(window.handle, action, execution.signal)
      return { done: await windowOutcome(backend, window, action, execution.signal) }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_open',
    description: 'Start an installed app by name (app: "Calculator", "Microsoft Word", "Visual Studio Code", "chrome") and report the window it opened; or open a file, folder, URL, or a system page (on Windows, settings pages such as ms-settings:display or ms-settings:network) with its default app, the way double-clicking it would.',
    parameters: {
      app: { type: 'string', description: 'Name of an installed app as shown in the Start menu or application menu, or its command.' },
      target: { type: 'string', description: 'Instead of app: absolute path, URL, or URI such as ms-settings:bluetooth.' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: { app?: string; target?: string }, execution) {
      if (args.app !== undefined && args.app.trim().length > 0) return { done: await launchApp(args.app, execution.signal) }
      const opened = (args.target ?? '').trim()
      if (opened.length === 0) throw new Error('pass app (an app name) or target (a path, URL or URI)')
      await backend.open(opened)
      return { done: `Opened ${opened}. Use desktop_window wait or list to find its window.` }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_element',
    description: 'Act on one control of a window by its number [n] from desktop_window read, or by its visible name, type or automation id: find, click, double_click, right_click, invoke (press a button or menu item), toggle (a check box), expand or collapse (a tree item, combo box or menu), select (a list item, tab or radio button), set_value (fill a text box) or focus. '
      + 'Exact points come from the app, so no coordinates are guessed. When no control matches a name, click actions fall back to text recognized on screen.',
    parameters: {
      action: { type: 'string', required: true, description: 'find, click, double_click, right_click, invoke, toggle, expand, collapse, select, set_value or focus.' },
      index: { type: 'number', description: 'Element number [n] from the latest desktop_window read or find of this window.' },
      name: { type: 'string', description: 'Visible name or text of the control, such as "Save", "OK" or "File name"; exact matches win over partial ones.' },
      role: { type: 'string', description: 'Control type to narrow the search: Button, Edit, CheckBox, RadioButton, ComboBox, ListItem, MenuItem, TabItem, TreeItem, Hyperlink, Text.' },
      automation_id: { type: 'string', description: 'Automation id of the control, when known.' },
      value: { type: 'string', description: 'For set_value: the new text or number.' },
      ...focusParameters,
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: ElementArgs, execution) {
      return { done: await elementStep(args, execution.signal) }
    },
  }), options)

  ctx.tools.register(defineTool({
    name: 'desktop_ocr',
    description: 'Read the text shown on screen with text recognition: one window, one display, a region, or every display. Works for anything visible, including apps without accessible controls, games, remote desktops, images and video. '
      + 'Each line comes with its centre point in desktop pixels, ready for desktop_pointer.',
    parameters: {
      ...focusParameters,
      display: { type: 'number', description: 'Display index; omit window, title and display (and the region) to read the foreground window.' },
      x: { type: 'number', description: 'Read only this region: its left edge in virtual-desktop pixels (with y, width and height).' },
      y: { type: 'number', description: 'Region top edge.' },
      width: { type: 'number', description: 'Region width.' },
      height: { type: 'number', description: 'Region height.' },
      all: { type: 'boolean', description: 'Read every display instead of the foreground window.' },
    },
    output: { schema: DONE_SCHEMA, render: (_args, value) => [{ type: 'text', text: value.done }] },
    async execute(args: AreaArgs & { all?: boolean }, execution) {
      if (backend.ocr === undefined) throw new Error('reading text from the screen is not available on this platform')
      let lines: OcrLine[]
      let label: string
      if (args.x !== undefined || args.y !== undefined || args.width !== undefined || args.height !== undefined) {
        if (args.x === undefined || args.y === undefined || args.width === undefined || args.height === undefined) throw new Error('a region needs x, y, width and height')
        if (args.width < 8 || args.height < 8) throw new Error('a region must be at least 8 pixels wide and high')
        lines = await backend.ocr({ x: args.x, y: args.y, width: args.width, height: args.height })
        label = `region ${String(args.width)}x${String(args.height)} at (${String(args.x)}, ${String(args.y)})`
      } else if (args.display !== undefined || args.all === true) {
        const displays = await backend.list()
        const chosen = args.display === undefined ? displays : [pick(displays, args.display)]
        lines = (await Promise.all(chosen.map(display => backend.ocr?.(display) ?? Promise.resolve([])))).flat()
        label = args.display === undefined ? `all ${String(displays.length)} displays` : `display ${describe(chosen[0] as DisplayInfo)}`
      } else {
        const window = await chosenWindow(args.window, args.title)
        lines = await windowOcr(window, execution.signal)
        label = `window ${describeWindow(window)}`
      }
      return { done: `Text recognized in ${label}:\n${lines.length > 0 ? formatOcr(lines) : '(no text recognized)'}` }
    },
  }), options)

  /** Find, click or operate one control of a window; shared by desktop_element and the sequence step. */
  async function elementStep(args: ElementArgs, signal: AbortSignal): Promise<string> {
    const action = args.action
    if (!ELEMENT_ACTIONS.has(action)) throw new Error(`action must be one of ${[...ELEMENT_ACTIONS].join(', ')}`)
    const window = await chosenWindow(args.window, args.title)
    if (window.minimized) await backend.window(window.handle, 'restore', signal)
    const clicks = CLICK_ACTIONS[action]
    let index = args.index
    if (index === undefined) {
      const query = { name: args.name, role: args.role, automationId: args.automation_id }
      if ((query.name ?? query.role ?? query.automationId ?? '').trim().length === 0) throw new Error('pass index (from desktop_window read) or name, role or automation_id')
      const found = backend.findElements === undefined ? '' : (await backend.findElements(window.handle, query)).trim()
      const lines = found.split('\n').map(line => line.trim()).filter(line => line.length > 0)
      if (lines.length === 0) {
        if (clicks !== undefined && args.name !== undefined && backend.ocr !== undefined) {
          const seen = findOcrLine(await windowOcr(window, signal), args.name)
          if (seen !== undefined) {
            const x = Math.round(seen.x + seen.width / 2)
            const y = Math.round(seen.y + seen.height / 2)
            await backend.pointer(x, y, clicks.button, clicks.count, undefined, signal)
            return `No control is named "${args.name}", so the text "${seen.text}" recognized on screen was clicked at (${String(x)}, ${String(y)}) in ${describeWindow(window)}. Check the result.`
          }
        }
        throw new Error(backend.findElements === undefined
          ? 'controls are not available on this platform; use desktop_ocr to find text and desktop_pointer to click it'
          : `no control in "${window.title}" matches ${JSON.stringify(query)}${backend.ocr === undefined ? '' : ', and no such text was recognized on screen'}; read the window to see its controls`)
      }
      const shown = lines.map(line => line.replace(/^[=~]/u, ''))
      if (action === 'find') return `Controls of ${describeWindow(window)} matching ${JSON.stringify(query)}:\n${shown.join('\n')}`
      const exact = lines.filter(line => line.startsWith('='))
      const chosen = exact.length === 1 ? exact[0] : lines.length === 1 ? lines[0] : undefined
      if (chosen === undefined) throw new Error(`${String(lines.length)} controls match; pass index:\n${shown.join('\n')}`)
      index = Number(/\[(\d+)\]/u.exec(chosen)?.[1])
    } else if (action === 'find') {
      throw new Error('find needs name, role or automation_id')
    }
    if (backend.elementPoint === undefined || backend.elementAction === undefined) throw new Error('controls are not available on this platform')
    // Real input lands on whatever is on top at the point, so the window comes to the front first.
    const front = async (): Promise<void> => { if (!window.foreground) await backend.window(window.handle, 'focus', signal) }
    if (clicks !== undefined) {
      const at = await backend.elementPoint(window.handle, index)
      await onDisplay(at.x, at.y)
      await front()
      await backend.pointer(at.x, at.y, clicks.button, clicks.count, undefined, signal)
      return `${action.replace('_', ' ')} on [${String(index)}] at (${String(at.x)}, ${String(at.y)}) in "${window.title}"`
    }
    if (action === 'set_value' && args.value === undefined) throw new Error('set_value needs value')
    const out = (await backend.elementAction(window.handle, index, action as ElementPatternAction, args.value)).trim()
    const fallback = /^(CLICK|TYPE) (-?\d+) (-?\d+)$/u.exec(out)
    if (fallback === null) return `${action} [${String(index)}] done; now ${out}`
    const x = Number(fallback[2])
    const y = Number(fallback[3])
    await front()
    await backend.pointer(x, y, 'left', 1, undefined, signal)
    if (fallback[1] === 'CLICK') return `[${String(index)}] does not support ${action}, so it was clicked at (${String(x)}, ${String(y)}) instead; check the result.`
    await backend.keys(parseKeys('ctrl+a'), signal)
    await backend.type(args.value ?? '', (args.value ?? '').length > PASTE_THRESHOLD, signal)
    return `[${String(index)}] takes no direct value, so it was clicked at (${String(x)}, ${String(y)}), its text selected and "${(args.value ?? '').slice(0, 80)}" typed.`
  }

  ctx.tools.register(defineTool({
    name: 'desktop_sequence',
    description: 'Run several whole-desktop actions in order in one call, stopping at the first failure: launch, open, keys, type, wait, read, ocr, element, focus, minimize, maximize, restore, close, move, click, drag, scroll, sleep. '
      + 'Use it for steps whose outcome you can predict, such as launch an app, wait for its window, press a control by name, type, and end with read to check the result in the same call. '
      + 'Example: [{"action":"launch","app":"Notepad"},{"action":"wait","title":"Notepad"},{"action":"type","text":"hello"},{"action":"element","element_action":"click","name":"File"},{"action":"read","title":"Notepad"}].',
    parameters: {
      steps: {
        type: 'array',
        required: true,
        description: 'Up to 30 steps. Each takes the same fields as the single-action tool it mirrors.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string', required: true, description: 'launch, open, keys, type, wait, read, ocr, element, focus, minimize, maximize, restore, close, move, click, drag, scroll or sleep.' },
            app: { type: 'string', description: 'launch: app name, such as "Calculator".' },
            keys: { type: 'string', description: 'keys: chords such as "ctrl+s" or "alt+tab enter".' },
            text: { type: 'string', description: 'type: text to type, a newline presses Enter; wait: wait until the window shows this text.' },
            target: { type: 'string', description: 'open: path, URL or URI.' },
            title: { type: 'string', description: 'wait, read, ocr, element, focus, minimize, maximize, restore, close, move: part of the window title or the process name; keys and type: window to bring forward first.' },
            handle: { type: 'number', description: 'Window handle, instead of title.' },
            gone: { type: 'boolean', description: 'wait: wait for the window (or the text) to go away.' },
            timeout_ms: { type: 'number', description: 'wait: limit in milliseconds (default 15000).' },
            element_action: { type: 'string', description: 'element: click, double_click, right_click, invoke, toggle, expand, collapse, select, set_value or focus.' },
            name: { type: 'string', description: 'element: visible name of the control.' },
            role: { type: 'string', description: 'element: control type, such as Button or Edit.' },
            index: { type: 'number', description: 'element: number [n] from an earlier read of the window.' },
            value: { type: 'string', description: 'element set_value: the new value.' },
            width: { type: 'number', description: 'move: new width.' },
            height: { type: 'number', description: 'move: new height.' },
            x: { type: 'number', description: 'click, scroll: virtual-desktop x; drag: start x; move: new left edge.' },
            y: { type: 'number', description: 'click, scroll: virtual-desktop y; drag: start y; move: new top edge.' },
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
      case 'launch':
        return launchApp(step.app ?? '', signal)
      case 'element':
        return elementStep({
          action: step.element_action ?? '', index: step.index, name: step.name, role: step.role, value: step.value, window: step.handle, title: step.title,
        }, signal)
      case 'ocr': {
        const window = await chosenWindow(step.handle, step.title)
        return `text on screen in "${window.title}":\n${formatOcr(await windowOcr(window, signal)) || '(none recognized)'}`
      }
      case 'move':
        return moveWindow(selectWindow(await backend.windows(), step.handle, step.title), step, signal)
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
      case 'wait': {
        if (step.text === undefined) return waitForWindow(backend, step.title, step.gone === true, step.timeout_ms ?? 15_000, signal)
        const window = await chosenWindow(step.handle, step.title)
        return waitForText(() => windowText(window, signal), step.text, step.gone === true, step.timeout_ms ?? 15_000, signal)
      }
      case 'read': {
        const window = await chosenWindow(step.handle, step.title)
        const text = await windowText(window, signal)
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

/** A window, display or region chosen by `desktop_screenshot` and `desktop_ocr`. */
interface AreaArgs extends Partial<CaptureArea> {
  window?: number
  title?: string
  display?: number
}

/** A point in desktop pixels, or in the latest screenshot image. */
interface PointArgs {
  x?: number
  y?: number
  image_x?: number
  image_y?: number
}

/** Arguments of `desktop_window`. */
interface WindowArgs extends Partial<CaptureArea> {
  action: string
  handle?: number
  title?: string
  text?: string
  gone?: boolean
  timeout_ms?: number
}

/** Arguments of `desktop_element` and of the sequence's element step. */
export interface ElementArgs {
  action: string
  index?: number | undefined
  name?: string | undefined
  role?: string | undefined
  automation_id?: string | undefined
  value?: string | undefined
  window?: number | undefined
  title?: string | undefined
}

/** Every `desktop_element` action. */
const ELEMENT_ACTIONS: ReadonlySet<string> = new Set(['find', 'click', 'double_click', 'right_click', 'invoke', 'toggle', 'expand', 'collapse', 'select', 'set_value', 'focus'])

/** Element actions done with a real click at the control's centre. */
const CLICK_ACTIONS: Readonly<Record<string, { button: PointerButton; count: number } | undefined>> = {
  click: { button: 'left', count: 1 }, double_click: { button: 'left', count: 2 }, right_click: { button: 'right', count: 1 },
}

/** One step of `desktop_sequence`. */
export interface SequenceStep {
  action: string
  app?: string
  element_action?: string
  name?: string
  role?: string
  index?: number
  value?: string
  width?: number
  height?: number
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
