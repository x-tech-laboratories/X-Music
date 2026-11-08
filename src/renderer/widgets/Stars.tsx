import { ratingToStars, starsToRating } from '@shared/fields'
import { cx } from '../lib/cx'

// Ratings are stored 0-100 with NULL meaning unrated, which is not the same as 0 (§3.6).
export function Stars({
  value = null,
  onchange
}: { value?: number | null; onchange?: (v: number) => void }) {
  const stars = ratingToStars(value) ?? 0

  return (
    <div
      className="rating"
      role="slider"
      tabIndex={0}
      aria-label="Rating"
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={stars}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={cx('star', n <= stars && 'on')}
          onClick={() => onchange?.(starsToRating(n))}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
        >★</button>
      ))}
    </div>
  )
}
