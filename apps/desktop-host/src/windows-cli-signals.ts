/** Deliver console interrupts to CLI listeners in Electron's Windows Node mode. */

/**
 * Register the CLI process's Windows console handler.
 * Koffi queues callbacks from the console thread onto the JavaScript thread.
 * The registration lasts until process exit; unknown events retain native handling.
 * @returns Completion once the console handler is registered.
 */
export async function installWindowsCliSignals(): Promise<void> {
  const { default: koffi } = await import('koffi')
  const kernel = koffi.load('kernel32.dll')
  const type = koffi.proto('int __stdcall DshCliConsoleHandler(uint32_t event)')
  const handler = koffi.register((event: number) => {
    if (event === 0) return Number(process.emit('SIGINT'))
    if (event === 1) return Number(process.emit('SIGBREAK'))
    return 0
  }, koffi.pointer(type))
  const install = kernel.func('int __stdcall SetConsoleCtrlHandler(DshCliConsoleHandler *handler, int add)')
  if (!install(handler, 1)) {
    koffi.unregister(handler)
    throw new Error('desktop CLI: cannot register the Windows console handler')
  }
  // A process inherits "ignore Ctrl+C" from a parent that set it (some IDEs and launchers do), and Windows then never
  // delivers CTRL_C_EVENT to any handler. Restore normal Ctrl+C processing so Ctrl+C always reaches SIGINT.
  const restore = kernel.func('int __stdcall SetConsoleCtrlHandler(void *handler, int add)')
  restore(null, 0)
}
