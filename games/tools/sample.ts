import { writeFileSync } from 'node:fs';
import { test } from 'vitest';
import { generateLevel } from '../src/survival/generate';
import { nodeAt } from '../src/survival/model';

/** Prints a board, so the gate spread can be eyeballed rather than trusted. */
test('sample', () => {
  const lines: string[] = [];
  for (const level of [1, 12, 30]) {
    const { board } = generateLevel('sample', level);
    lines.push(`--- level ${level}: ${board.lanes} lanes, start ${board.startCount}, horde ${board.horde} ---`);
    for (let row = board.rows - 1; row >= 0; row--) {
      const cells: string[] = [];
      for (let lane = 0; lane < board.lanes; lane++) {
        const n = nodeAt(board, row, lane);
        cells.push(
          (n.kind === 'barrier'
            ? `[${n.hp}]`
            : n.op === 'mul'
              ? `x${n.value}`
              : n.op === 'div'
                ? `/${n.value}`
                : n.op === 'sub'
                  ? `-${n.value}`
                  : `+${n.value}`
          ).padStart(9),
        );
      }
      lines.push(cells.join(''));
    }
    lines.push('');
  }
  writeFileSync('tools/sample.txt', lines.join('\n'));
}, 120_000);
