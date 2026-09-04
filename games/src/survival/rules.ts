/**
 * Survival's rules sheet. See `shared/how-to-play.ts`.
 *
 * This is the game that most needs one. It looks like the real-time lane runner
 * it is derived from and it is not: nothing moves until you commit, the whole
 * board is on screen to be read before the first step, and the reach limit —
 * one lane of sideways movement per row — is invisible until a tap is refused.
 * A player who assumes they can drive straight at the biggest multiplier will
 * spend their first few levels losing to a rule nobody mentioned.
 */

import type { GameRules } from '../shared/how-to-play';

/* Cell geometry, all in the 92x64 art viewBox. Three lanes across, two rows of
   board, and the squad on its start line underneath. */
const CW = 26;
const CH = 17;
const COL_X = [6, 35, 64];
const ROW_Y = [6, 26];

type Tone = 'good' | 'bad';

const colX = (col: number): number => COL_X[col] ?? 6;
const rowY = (row: number): number => ROW_Y[row] ?? 6;
const colMid = (col: number): number => colX(col) + CW / 2;
const rowMid = (row: number): number => rowY(row) + CH / 2;

/** A gate: an arithmetic operation the squad walks into. */
function gate(col: number, row: number, label: string, tone: Tone = 'good'): string {
  const fill = tone === 'good' ? '#35b56a' : '#e6394a';
  return (
    `<rect x="${colX(col)}" y="${rowY(row)}" width="${CW}" height="${CH}" rx="4" ` +
    `fill="${fill}" fill-opacity="0.22" stroke="${fill}" stroke-width="1.5"/>` +
    `<text class="ha-label" x="${colMid(col)}" y="${rowMid(row)}">${label}</text>`
  );
}

/** A barrier: a wall that has to be outnumbered, and takes its strength with it. */
function barrier(col: number, row: number, hp: string): string {
  const x = colX(col);
  const y = rowY(row);
  return (
    `<rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="4" fill="#6b7fa8" ` +
    `fill-opacity="0.3" stroke="#6b7fa8" stroke-width="2.4"/>` +
    `<rect x="${x + 3}" y="${y + 3}" width="${CW - 6}" height="${CH - 6}" rx="2" ` +
    `fill="none" stroke="#6b7fa8" stroke-width="1" stroke-opacity="0.8"/>` +
    `<text class="ha-label ha-label--sm" x="${colMid(col)}" y="${rowMid(row)}">${hp}</text>`
  );
}

/** The squad, on the start line under the board. */
function squad(col: number, count: string): string {
  return (
    `<rect class="ha-accent-fill" x="${colX(col) + 3}" y="47" width="${CW - 6}" height="15" rx="4"/>` +
    `<text class="ha-label ha-label--invert" x="${colMid(col)}" y="54.5">${count}</text>`
  );
}

/** Marks a cell the squad could step into from where it is. */
function inReach(col: number, row: number): string {
  return (
    `<rect class="ha-accent" x="${colX(col) - 2}" y="${rowY(row) - 2}" width="${CW + 4}" ` +
    `height="${CH + 4}" rx="6" stroke-width="1.7" stroke-dasharray="4 3"/>`
  );
}

/** Crosses a cell out: too far sideways to step into from where the squad is. */
function outOfReach(col: number, row: number): string {
  const x = colX(col);
  const y = rowY(row);
  return (
    `<rect class="ha-veil" x="${x}" y="${y}" width="${CW}" height="${CH}" rx="4"/>` +
    `<path class="ha-strike" d="M${x + 8} ${y + 5} l${CW - 16} ${CH - 10} ` +
    `M${x + CW - 8} ${y + 5} l-${CW - 16} ${CH - 10}" stroke-width="1.9" stroke-linecap="round"/>`
  );
}

/**
 * "Tap here" around a cell.
 *
 * The shared `artTap` draws rings, which is right for a screw or a person and
 * wrong for a 26x17 cell — a circle either sits inside it or cuts its corners
 * off. This is the same idea in the board's own geometry.
 */
function tapCell(col: number, row: number): string {
  const ring = (inset: number, faint: boolean): string =>
    `<rect class="ha-accent${faint ? ' ha-faint' : ''}" x="${colX(col) - inset}" ` +
    `y="${rowY(row) - inset}" width="${CW + inset * 2}" height="${CH + inset * 2}" ` +
    `rx="${5 + inset}" stroke-width="${faint ? 1.4 : 1.9}"/>`;
  return ring(2, false) + ring(5.5, true);
}

/** A short accent arrow pointing straight up, for "you go this way". */
function up(x: number, from: number, to: number): string {
  return (
    `<path class="ha-accent" d="M${x} ${from} V${to}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path class="ha-accent" d="M${x - 5} ${to + 5} l5 -5 l5 5" stroke-width="1.8" ` +
    `stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

export const RULES: GameRules = {
  gameName: 'Survival',
  goal: 'Walk your squad up the board and arrive at the top outnumbering the horde.',
  steps: [
    {
      title: 'Nothing moves until you tap',
      text:
        'This is not a race. The whole board is on screen from the start and it waits for ' +
        'you — tap a cell in the row directly ahead and the squad walks into it.',
      art:
        gate(0, 0, '+40') +
        gate(1, 0, '×3') +
        gate(2, 0, '−12', 'bad') +
        gate(0, 1, '×2') +
        gate(1, 1, '+15') +
        gate(2, 1, '÷2', 'bad') +
        squad(1, '20') +
        tapCell(1, 1),
    },
    {
      title: 'Every cell changes your numbers',
      text:
        'Multiply, add, subtract, divide — and grey walls have to be outnumbered, then ' +
        'take their own strength with them. Order matters: ×3 then +50 is not +50 then ×3.',
      art:
        gate(0, 0, '×4') +
        gate(1, 0, '+90') +
        gate(2, 0, '−25', 'bad') +
        gate(0, 1, '+30') +
        gate(1, 1, '×2') +
        barrier(2, 1, '18') +
        squad(1, '12'),
    },
    {
      title: 'You can only step one lane sideways',
      text:
        'From row to row you may shift a lane, sometimes two — never straight across the ' +
        'board. So the best cell up ahead may simply not be reachable from where you are.',
      art:
        gate(0, 0, '×5') +
        outOfReach(0, 0) +
        gate(1, 0, '+20') +
        inReach(1, 0) +
        gate(2, 0, '×2') +
        inReach(2, 0) +
        gate(0, 1, '+8') +
        gate(1, 1, '+40') +
        gate(2, 1, '×3') +
        squad(2, '30'),
    },
    {
      title: 'Arrive at the top with more than the horde',
      text:
        'The number waiting up there is the one to beat, and it is on screen from the ' +
        'first move. Get past it and the level is yours.',
      art:
        `<rect x="6" y="4" width="80" height="16" rx="5" fill="#e6394a" fill-opacity="0.22" ` +
        `stroke="#e6394a" stroke-width="1.6"/>` +
        `<text class="ha-label ha-label--sm" x="46" y="12">HORDE 480</text>` +
        up(46, 44, 26) +
        `<rect class="ha-accent-fill" x="26" y="47" width="40" height="15" rx="5"/>` +
        `<text class="ha-label ha-label--invert" x="46" y="54.5">612</text>`,
    },
  ],
};
