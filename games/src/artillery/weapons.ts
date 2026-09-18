/**
 * The weapons, as data.
 *
 * Every one of them is the same four numbers in a different arrangement — how
 * many shells leave the barrel, how wide the blast is, how much life it takes,
 * and what it does to the ground — which is the whole reason this is a table
 * rather than seventeen functions. A weapon that needed code of its own would
 * be a fifth mechanic, and the fifth mechanic is where an artillery game starts
 * growing homing missiles and teleports.
 *
 * Three axes are genuinely independent, and the interesting weapons pull them
 * apart:
 *
 *  - **damage against blast radius.** Super Zapper takes 58 life inside six
 *    units and nothing outside it, so it is a reward for having already found
 *    the range. Flea Circus takes six a shell across twelve shells, so it is
 *    how you find the range in the first place.
 *  - **damage against digging.** Crater Maker barely hurts and rearranges the
 *    battlefield; Sledgehammer hurts badly and leaves a dent.
 *  - **taking ground away against putting it back.** The dirt weapons do no
 *    damage at all. They are for building a wall you can hide behind and for
 *    filling in the hole somebody just dropped you into.
 *
 * **Each drafted weapon fires once.** That is what makes the draft the real
 * decision of the match rather than a menu you stop reading on turn three, and
 * it is why the plain shell is unlimited: a player who has spent everything
 * must still have something to shoot.
 */

export type WeaponKind = 'shell' | 'cluster' | 'dirt' | 'digger';

export interface Weapon {
  id: string;
  name: string;
  kind: WeaponKind;
  /** Shells that leave the barrel. */
  shots: number;
  /** Degrees between neighbouring shells of a cluster. */
  spread: number;
  /** Blast radius, world units. */
  radius: number;
  /** Life taken at the centre of the blast. */
  damage: number;
  /** Multiplier on how much ground the blast removes. */
  dig: number;
  /** Ground added, as a multiple of the blast's own thickness. Dirt only. */
  fill: number;
  /** Depth of the shaft a digger sinks below its blast. */
  shaft: number;
  /** One short line in the shop. Says what it is for, not what it is. */
  blurb: string;
}

const weapon = (
  id: string,
  name: string,
  kind: WeaponKind,
  blurb: string,
  stats: Partial<Omit<Weapon, 'id' | 'name' | 'kind' | 'blurb'>>,
): Weapon => ({
  id,
  name,
  kind,
  blurb,
  shots: 1,
  spread: 0,
  radius: 9,
  damage: 0,
  dig: 1,
  fill: 0,
  shaft: 0,
  ...stats,
});

/**
 * The one nobody drafts, because everybody has it.
 *
 * Deliberately a perfectly reasonable weapon rather than a token one. It is
 * what a long match is played with once both arsenals are spent, so a peashooter
 * here would turn the endgame into a stalemate with extra steps.
 */
export const PLAIN_SHELL: Weapon = weapon(
  'plain',
  'Plain Shell',
  'shell',
  'Never runs out.',
  { radius: 9, damage: 20, dig: 0.9 },
);

/** The draft pool. Sixteen, so each side ends up with eight. */
export const POOL: readonly Weapon[] = [
  weapon('bertha', 'Big Bertha', 'shell', 'Wide blast, heavy damage.', {
    radius: 20,
    damage: 40,
    dig: 1.2,
  }),
  weapon('bigshot', 'Big Shot', 'shell', 'A larger plain shell.', {
    radius: 15,
    damage: 34,
  }),
  weapon('sledge', 'Sledgehammer', 'shell', 'Hits hard, barely digs.', {
    radius: 8,
    damage: 46,
    dig: 0.5,
  }),
  weapon('zapper', 'Super Zapper', 'shell', 'Enormous damage, tiny blast.', {
    radius: 6,
    damage: 58,
    dig: 0.2,
  }),
  weapon('poprocket', 'Pop Rocket', 'shell', 'Quick and reliable.', {
    radius: 11,
    damage: 26,
    dig: 0.8,
  }),
  weapon('crater', 'Crater Maker', 'shell', 'Rearranges the hillside.', {
    radius: 26,
    damage: 24,
    dig: 1.4,
  }),
  weapon('triple', 'Triple Shot', 'cluster', 'Three shells, well spaced.', {
    shots: 3,
    spread: 7,
    radius: 9,
    damage: 20,
    dig: 0.8,
  }),
  weapon('fiveshot', 'Five Shot', 'cluster', 'Five shells in a fan.', {
    shots: 5,
    spread: 4.5,
    radius: 7,
    damage: 14,
    dig: 0.7,
  }),
  weapon('scatter', 'Scatter Shot', 'cluster', 'Wide fan, light damage.', {
    shots: 7,
    spread: 9,
    radius: 6,
    damage: 11,
    dig: 0.6,
  }),
  weapon('hailstorm', 'Hail Storm', 'cluster', 'Nine shells, tight group.', {
    shots: 9,
    spread: 2.5,
    radius: 5,
    damage: 9,
    dig: 0.5,
  }),
  weapon('flea', 'Flea Circus', 'cluster', 'Sprays the whole hillside.', {
    shots: 12,
    spread: 14,
    radius: 4,
    damage: 6,
    dig: 0.4,
  }),
  weapon('digger', 'Digger', 'digger', 'Sinks a shaft where it lands.', {
    radius: 8,
    damage: 22,
    shaft: 34,
  }),
  weapon('drillers', 'Drillers', 'digger', 'Three shallow shafts.', {
    shots: 3,
    spread: 4,
    radius: 6,
    damage: 12,
    shaft: 22,
  }),
  weapon('dirtball', 'Dirt Ball', 'dirt', 'Drops earth. No damage.', {
    radius: 14,
    fill: 1,
  }),
  weapon('mudpie', 'Mud Pie', 'dirt', 'A wide, shallow mound.', {
    radius: 24,
    fill: 0.55,
  }),
  weapon('sandwall', 'Sand Wall', 'dirt', 'A narrow wall to hide behind.', {
    radius: 7,
    fill: 2.6,
  }),
];

/** Every weapon that exists, the plain shell included. */
const BY_ID = new Map<string, Weapon>([
  [PLAIN_SHELL.id, PLAIN_SHELL],
  ...POOL.map((item) => [item.id, item] as const),
]);

/** Throws on an unknown id: a save naming a weapon this build dropped is a bug. */
export function weaponById(id: string): Weapon {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`no such weapon: ${id}`);
  return found;
}

export function isWeaponId(id: string): boolean {
  return BY_ID.has(id);
}

/** How many each side drafts. */
export const ARSENAL_SIZE = POOL.length / 2;

/**
 * The barrel angles a weapon leaves the muzzle at, in degrees, for an aim of
 * `angle`. Symmetric about the aim, so a cluster straddles what you pointed at
 * rather than landing to one side of it.
 */
export function barrelAngles(weapon: Weapon, angle: number): number[] {
  const angles: number[] = [];
  const middle = (weapon.shots - 1) / 2;
  for (let i = 0; i < weapon.shots; i++) {
    angles.push(angle + (i - middle) * weapon.spread);
  }
  return angles;
}
