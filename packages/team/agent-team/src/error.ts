/** Typed Agent Teams failures. */

import { HarnessError } from '@hackdevcode/dsh-llm'

/** Stable failure raised by the Team domain. */
export class TeamError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'TeamError'
  }
}
