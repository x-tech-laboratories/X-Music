// The theme choice, kept in X-Music's prefs under the key it has always used.

import { browser_storage, one_of, read_pref, write_pref } from '@x-tech-laboratories/x-libs/web/prefs'
import { theme_choice, type Theme } from '@x-tech-laboratories/x-libs/web/theme'

const key = 'x-music.pref.theme'
const is_theme = one_of<Theme>('system', 'light', 'dark')

export const theme = theme_choice({
  read: () => {
    const saved = read_pref(browser_storage(), key, 'system', is_theme)
    return saved === 'system' ? undefined : saved
  },
  write: (choice) => write_pref(browser_storage(), key, choice)
})
