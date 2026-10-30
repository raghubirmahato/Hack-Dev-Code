/** CSS-only running indicator: a pulsing brand-mark dot for the running Chat status. */
import css from './ChatView.module.css'

/**
 * Render the decorative running icon; the stylesheet owns the animation and
 * switches it off under reduced motion or forced colors.
 * @returns a fixed-footprint icon seat holding the pulsing mark.
 */
export function RunningMark() {
  return (
    <span className={css.runningIcon} aria-hidden="true">
      <span className={css.runningMark} />
    </span>
  )
}
