// The stand-in bridge with every call recorded and answers that can read the call's arguments.

import { install_bridge, type Call } from './bridge'

export type { Call }

export function record_calls(answers: Record<string, unknown> = {}): Call[] {
  return install_bridge(answers)
}
