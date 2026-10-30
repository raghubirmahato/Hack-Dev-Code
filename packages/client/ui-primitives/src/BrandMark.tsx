import type { IconProps } from './icons/props.ts'

/** Native viewBox of {@link BRAND_MARK_PATH} (width and height in user units). */
export const BRAND_MARK_VIEWBOX = { width: 24, height: 24 }

/**
 * The Hack Dev Code mark: a torii gate — the guild's Sentinel Gate every change
 * must pass — with a terminal prompt `>_` walking through it. One even-odd path,
 * exported for consumers that compose their own svg around the same geometry.
 */
export const BRAND_MARK_PATH = 'M1.2 3.2C6.6 4.9 17.4 4.9 22.8 3.2L22.2 6.3C20.9 6.9 19.6 7.25 18.4 7.4L17.9 7.4L18.03 9.7'
  + 'L19.9 9.7L19.9 11.3L18.12 11.3L18.7 21.6L16.4 21.6L15.96 11.3L8.04 11.3L7.6 21.6L5.3 21.6L5.88 11.3L4.1 11.3'
  + 'L4.1 9.7L5.97 9.7L6.1 7.4L5.6 7.4C4.4 7.25 3.1 6.9 1.8 6.3Z'
  + 'M8.2 7.4L15.8 7.4L15.9 9.7L8.1 9.7Z'
  + 'M9.2 13.3L10.3 12.2L13.5 15.4L10.3 18.6L9.2 17.5L11.3 15.4Z'
  + 'M12.6 18.4L15.2 18.4L15.2 19.7L12.6 19.7Z'

/**
 * Render the Hack Dev Code mark.
 * @param props.size - width in px (default 24; the mark is square).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function BrandMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * BRAND_MARK_VIEWBOX.height) / BRAND_MARK_VIEWBOX.width}
      className={className}
      viewBox={`0 0 ${BRAND_MARK_VIEWBOX.width} ${BRAND_MARK_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d={BRAND_MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
