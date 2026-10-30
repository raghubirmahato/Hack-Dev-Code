/** Shared English zoom copy embedded into renderer-owned dictionaries. */
export const zoomEn = {
  zoomControls: 'Zoom controls',
  zoomMenu: 'Choose zoom',
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  zoomFitWidth: 'Fit width',
  zoomValue: '{percent}%',
} satisfies Record<string, string>

/** Shared zoom dictionary keys. */
export type ZoomLocaleKey = keyof typeof zoomEn
