import { BrandWordmark, BrandMark } from '@hackdevcode/dsh-client-ui-primitives'
import type { SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps } from '@hackdevcode/dsh-client-ui-sidebar/client'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the Hack Dev Code mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <BrandMark size={size} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @param props - Host-supplied localized brand name.
 * @returns the official name wordmark.
 */
export function OfficialBrandName({ label }: SidebarBrandNameOwnerProps) {
  return <BrandWordmark includeMark={false} label={label} />
}
