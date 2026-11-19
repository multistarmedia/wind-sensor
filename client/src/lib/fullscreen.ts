/** Enter browser fullscreen for the demo console. Safe to call when already fullscreen. */
export async function enterAppFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (document.fullscreenElement) return;
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {
    // Browsers block fullscreen without a user gesture (e.g. auto-started demo).
  }
}

/** Leave browser fullscreen when exiting demo. */
export async function exitAppFullscreen(): Promise<void> {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    // ignore
  }
}
