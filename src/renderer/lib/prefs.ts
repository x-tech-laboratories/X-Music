// Remembered settings as React state: the reading and validating live in shared/prefs, this only ties them to a component.

import { useState } from 'react'
import { readPref, writePref, type Validator } from '@shared/prefs'

const storage = (): Storage | undefined =>
  typeof localStorage === 'undefined' ? undefined : localStorage

// A pref owned by one component, read once when it mounts and written on every change.
export function use_pref<Value>(key: string, initial: Value, validate?: Validator<Value>): [Value, (next: Value) => void] {
  const full_key = `x-music.pref.${key}`
  const [value, set_value] = useState(() => readPref(storage(), full_key, initial, validate))
  const change = (next: Value): void => {
    set_value(next)
    writePref(storage(), full_key, next)
  }
  return [value, change]
}
