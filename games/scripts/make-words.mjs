/**
 * Builds Wordle's word lists.
 *
 * Like the icons, the output is generated and committed rather than fetched at
 * runtime — the game has to work on a plane, and a word list is not something
 * that should change under a player mid-level. Run with `npm run words`.
 *
 * **Three public sources, each doing one job:**
 *
 *  - **ENABLE** decides what *is* a word. It is the open word-game list, and the
 *    reason it is used rather than a plain dictionary dump is that **it holds no
 *    proper nouns at all**. The first version of this used `words_alpha`, which
 *    does, and duly served up `ARABIA`, `THAMES` and `YAMATO` as answers. The
 *    obvious patch — filter against a list of place names — was measured and
 *    thrown away: a world cities file contains villages called Going, Never,
 *    Police and Wedding, so it removed a tenth of every answer list including
 *    most of the best words in it.
 *  - an English frequency list (from film and television subtitles) decides
 *    which of those words people actually use. Subtitles are a better fit here
 *    than a book corpus: the answers should be words somebody says, not words
 *    somebody writes.
 *  - two name lists throw out what ENABLE legitimately keeps but nobody would
 *    deduce. `MOLLY` is a fish and `BERLIN` is a carriage, so a word-game
 *    dictionary is right to hold them and this game is right not to ask for
 *    them.
 *
 * The output is two strings per length, each a run of fixed-width words with no
 * separators. That is the most compact form that still indexes in constant time,
 * and it is a third the size of a JSON array of the same words.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'wordle', 'words.ts');

const SOURCES = {
  dictionary: 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt',
  frequency:
    'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt',
  firstNames: 'https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt',
  surnames: 'https://raw.githubusercontent.com/dominictarr/random-name/master/names.txt',
};

/** Word lengths the game uses. See `generate.ts` for how they are handed out. */
const LENGTHS = [5, 6, 7];

/**
 * How many answers to keep per length, in frequency order.
 *
 * Measured by reading the list rather than picked: past about two thousand the
 * words stop being ones anybody would produce unprompted (`gowan`, `drury`,
 * `bossa`), and an answer you could not have guessed is a wasted level.
 */
const ANSWER_LIMIT = 2000;

async function fetchLines(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> ${response.status}`);
  return (await response.text()).split('\n');
}

const onlyLetters = (word) => /^[a-z]+$/.test(word);

async function main() {
  console.log('fetching sources…');
  const [dictionaryLines, frequencyLines, firstNameLines, surnameLines] = await Promise.all([
    fetchLines(SOURCES.dictionary),
    fetchLines(SOURCES.frequency),
    fetchLines(SOURCES.firstNames),
    fetchLines(SOURCES.surnames),
  ]);

  const dictionary = new Set();
  for (const line of dictionaryLines) {
    const word = line.trim().toLowerCase();
    if (onlyLetters(word)) dictionary.add(word);
  }

  /** Word -> rank. Lower is commoner. */
  const rank = new Map();
  for (const [index, line] of frequencyLines.entries()) {
    const word = line.split(' ')[0]?.trim().toLowerCase() ?? '';
    if (onlyLetters(word) && !rank.has(word)) rank.set(word, index);
  }

  const names = new Set();
  for (const line of [...firstNameLines, ...surnameLines]) {
    const word = line.trim().toLowerCase();
    if (onlyLetters(word)) names.add(word);
  }

  console.log(
    `dictionary ${dictionary.size}, ranked ${rank.size}, names ${names.size}`,
  );

  const guesses = {};
  const answers = {};

  for (const length of LENGTHS) {
    /*
     * A guess only has to be a word somebody might reasonably try, so the bar is
     * the frequency list — generous enough for every real opener (`crane`,
     * `slate`, `adieu`, `irate` all pass) without shipping the four hundred
     * kilobytes of the full dictionary, most of which nobody has ever seen.
     */
    const allowed = [...rank.keys()].filter(
      (word) => word.length === length && dictionary.has(word),
    );

    /*
     * An answer has to be *deducible*, which rules out two whole categories:
     *
     *  - **proper nouns**, which the subtitle corpus is full of;
     *  - **plain plurals and third-person verbs**, because `wants` and `wanted`
     *    and `wanting` are one word wearing three hats, and a board that comes
     *    down to which suffix it was is a coin toss rather than a deduction.
     *    Only the bare `-s` is cut: it is the one that collides with itself.
     */
    const answerWords = allowed
      .filter((word) => {
        if (names.has(word)) return false;
        if (word.endsWith('s') && !word.endsWith('ss') && dictionary.has(word.slice(0, -1))) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
      .slice(0, ANSWER_LIMIT);

    // Guesses are sorted so membership is a binary search over the packed
    // string rather than a Set built at start-up.
    allowed.sort();

    // Every answer must also be a legal guess. It is, by construction — answers
    // are a subset of `allowed` — but the game would be unplayable if that ever
    // stopped being true, so it is checked here rather than assumed.
    for (const word of answerWords) {
      if (!allowed.includes(word)) throw new Error(`answer ${word} is not a legal guess`);
    }

    guesses[length] = allowed;
    answers[length] = answerWords;

    console.log(
      `  ${length} letters: ${allowed.length} guesses (${Math.round(
        (allowed.length * length) / 1024,
      )}KB), ${answerWords.length} answers`,
    );
  }

  const packed = (words) => words.join('');

  const source = `/**
 * Wordle's word lists. Generated by \`scripts/make-words.mjs\` — do not edit.
 *
 * Each list is one string of fixed-width words with no separators, which is the
 * most compact form that still indexes in constant time. \`GUESSES\` is sorted
 * alphabetically so membership is a binary search; \`ANSWERS\` is in frequency
 * order, commonest first, because that order *is* the difficulty curve.
 *
 * Sources, and what each one decides:
 *   dictionary  ${SOURCES.dictionary}
 *   frequency   ${SOURCES.frequency}
 *   names       ${SOURCES.firstNames}
 *               ${SOURCES.surnames}
 */

/** Words a guess is allowed to be, sorted, packed by length. */
export const GUESSES: Readonly<Record<number, string>> = {
${LENGTHS.map((length) => `  ${length}: '${packed(guesses[length])}',`).join('\n')}
};

/** Words a level's answer is drawn from, commonest first, packed by length. */
export const ANSWERS: Readonly<Record<number, string>> = {
${LENGTHS.map((length) => `  ${length}: '${packed(answers[length])}',`).join('\n')}
};

/** The lengths the game uses. */
export const LENGTHS = [${LENGTHS.join(', ')}] as const;
`;

  writeFileSync(OUT, source);
  console.log(`wrote ${OUT} (${Math.round(source.length / 1024)}KB)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
