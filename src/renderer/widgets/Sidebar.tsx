import { useState } from 'react'
import { cx } from '../lib/cx'
import s from './Sidebar.module.css'

const sections = [
  { title: 'Library', items: ['All tracks', 'Albums', 'Artists', 'Genres', 'Recently added'] },
  { title: 'Smart playlists', items: ['Neglected gems', 'Top rated', 'Never played'] },
  { title: 'Playlists', items: [] as string[] },
  { title: 'Queue', items: [] as string[] }
]

export function Sidebar() {
  const [active, setActive] = useState('All tracks')

  return (
    <nav className={s.sidebar} aria-label="Library navigation">
      <div className={s.brand}>X-Music</div>

      {sections.map((section) => (
        <div key={section.title}>
          <div className={s.sectionTitle}>{section.title}</div>
          {section.items.length ? (
            <ul className={s.list}>
              {section.items.map((item) => (
                <li key={item}>
                  <button className={cx(s.item, active === item && s.active)} onClick={() => setActive(item)}>{item}</button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={s.empty}>None yet</div>
          )}
        </div>
      ))}
    </nav>
  )
}
