// The stand-in bridge with every call recorded and answers that can read the call's arguments.

import { CHANNELS } from '@shared/ipc'

import { install_bridge } from './bridge'

export interface Call {
  channel: string
  args: unknown[]
}

export function record_calls(answers: Record<string, unknown> = {}): Call[] {
  install_bridge()
  const calls: Call[] = []
  const fallback = window.xMusic
  Object.assign(window, {
    // A plain object of every channel, as the preload exposes it.
    xMusic: Object.fromEntries(CHANNELS.map((channel) => [channel, async (...args: unknown[]) => {
      calls.push({ channel, args })
      if (!(channel in answers)) return (fallback as unknown as Record<string, () => Promise<unknown>>)[channel]!()
      const answer = answers[channel]
      return typeof answer === 'function' ? (answer as (...args: unknown[]) => unknown)(...args) : answer
    }]))
  })
  return calls
}
