import { BRAND_MARK_PATH } from './BrandMark.tsx'
import type { IconProps } from './icons/props.ts'

/** Display options for the official brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Localized brand name drawn as the wordmark. */
  label: string
  /** Whether to include the leading torii-gate mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark.
 * @param props.label - localized brand name to draw.
 * @param props.size - height in px (default 24; width follows the selected artwork).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading torii-gate mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ label, size = 24, className, includeMark = true }: BrandWordmarkProps) {
  const width = includeMark ? 156 : 126
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 156 24' : '30 0 126 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && <path d={BRAND_MARK_PATH} fill="currentColor" fillRule="evenodd" />}
      <text
        x="31"
        y="17.5"
        textLength="124"
        lengthAdjust="spacingAndGlyphs"
        fill="currentColor"
        fontFamily="inherit"
        fontSize="17"
        fontWeight="700"
        letterSpacing="-0.2"
      >
        {label}
      </text>
    </svg>
  )
}
