/**
 * Board geometry.
 *
 * Tube count varies from 5 to 14 by level, so the arrangement has to be
 * measured rather than fixed: a puzzle you have to scroll to see is not a
 * puzzle you can solve. Rather than hard-code a row count, try each and keep
 * whichever makes the tubes biggest — on a tall phone that favours more rows,
 * on a short landscape window it collapses to one.
 */

/** Tube width as a multiple of band height. Matches the proportions of real test tubes. */
const ASPECT = 1.7;

/** Room below the last band for the rounded base. */
const BASE_LIP = 10;

/** Upper bound so tubes stay sane on a desktop window. */
const MAX_BAND = 58;
const MIN_BAND = 13;

/**
 * How much bigger an extra row has to make the tubes before it is worth taking.
 * Without this, seven tubes land on three rows of 3+3+1 for a 6% size gain,
 * when two rows of 4+3 look considerably tidier.
 */
const EXTRA_ROW_THRESHOLD = 1.1;

export interface BoardLayout {
  rows: number;
  cols: number;
  bandHeight: number;
  tubeWidth: number;
  colGap: number;
  rowGap: number;
  /** Width of exactly one full row, so the flex container wraps where intended. */
  boardWidth: number;
}

export function chooseLayout(
  tubeCount: number,
  capacity: number,
  availableWidth: number,
  availableHeight: number,
): BoardLayout {
  let best: BoardLayout | null = null;

  for (let rows = 1; rows <= 3; rows++) {
    if (rows > tubeCount) break;

    const cols = Math.ceil(tubeCount / rows);
    const colGap = cols > 6 ? 8 : 12;
    const rowGap = rows > 2 ? 16 : 26;

    const usableWidth = availableWidth - colGap * (cols - 1);
    const usableHeight = availableHeight - rowGap * (rows - 1);
    if (usableWidth <= 0 || usableHeight <= 0) continue;

    // Band height is limited by whichever runs out first: vertical room for the
    // stack, or horizontal room once the aspect ratio is respected.
    const fromHeight = (usableHeight / rows - BASE_LIP) / capacity;
    const fromWidth = usableWidth / cols / ASPECT;
    const bandHeight = Math.min(fromHeight, fromWidth, MAX_BAND);

    if (bandHeight < MIN_BAND) continue;
    if (best && bandHeight < best.bandHeight * EXTRA_ROW_THRESHOLD) continue;

    const tubeWidth = Math.min(bandHeight * ASPECT, usableWidth / cols);
    best = {
      rows,
      cols,
      bandHeight,
      tubeWidth,
      colGap,
      rowGap,
      boardWidth: tubeWidth * cols + colGap * (cols - 1),
    };
  }

  // Nothing fit comfortably — pack into the widest arrangement at minimum size
  // rather than overflowing the viewport.
  if (!best) {
    const rows = tubeCount <= 5 ? 1 : tubeCount <= 12 ? 2 : 3;
    const cols = Math.ceil(tubeCount / rows);
    const tubeWidth = Math.max(22, Math.min(MIN_BAND * ASPECT, availableWidth / cols - 6));
    return {
      rows,
      cols,
      bandHeight: MIN_BAND,
      tubeWidth,
      colGap: 6,
      rowGap: 12,
      boardWidth: tubeWidth * cols + 6 * (cols - 1),
    };
  }

  return best;
}

export function applyLayout(element: HTMLElement, layout: BoardLayout): void {
  const tubeWidth = Math.floor(layout.tubeWidth);
  element.style.setProperty('--tube-w', `${tubeWidth}px`);
  element.style.setProperty('--band-h', `${Math.floor(layout.bandHeight)}px`);
  element.style.setProperty('--col-gap', `${layout.colGap}px`);
  element.style.setProperty('--row-gap', `${layout.rowGap}px`);
  // Constrain the flex container to exactly one row's width so it wraps where
  // intended, and so a partial last row centres under the rows above it.
  element.style.setProperty(
    '--board-w',
    `${tubeWidth * layout.cols + layout.colGap * (layout.cols - 1)}px`,
  );
}
