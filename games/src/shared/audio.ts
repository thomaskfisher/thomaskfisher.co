/**
 * Tiny synthesised sound. No audio files — nothing to download, nothing to
 * cache, and it keeps the whole game a few dozen kilobytes.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so the
 * context is created lazily on the first tap and every call before that is a
 * no-op rather than an error.
 *
 * iOS is stricter than Android on two counts:
 *  - Web Audio is muted by the ring/silent switch unless the page asks for
 *    the "playback" audio session. Most iPhones live on silent, so without
 *    this the games are simply mute. The in-game setting is the mute.
 *  - The context only unlocks when resumed inside a touchend/click/keydown
 *    handler (pointerdown from a finger does not count), and Safari suspends
 *    or "interrupts" it whenever the page is backgrounded. So every gesture
 *    re-unlocks it, whatever the game does with that gesture.
 */

let context: AudioContext | null = null;
let enabled = true;

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

function claimPlaybackSession(): void {
  const session = (navigator as AudioSessionNavigator).audioSession;
  if (session && session.type !== 'playback') {
    try {
      session.type = 'playback';
    } catch {
      // Unsupported — nothing more to do.
    }
  }
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  // Turning sound on happens in a tap on the settings toggle.
  if (value) unlock();
}

function ctx(): AudioContext | null {
  if (!enabled) return null;
  if (context) {
    if (context.state !== 'running') void context.resume().catch(() => undefined);
    return context;
  }
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    claimPlaybackSession();
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/** Called from inside a user gesture: start or resume the context, and play a silent sample, which is what finally wakes it on older iOS. */
function unlock(): void {
  const audio = ctx();
  if (!audio) return;
  try {
    const source = audio.createBufferSource();
    source.buffer = audio.createBuffer(1, 1, audio.sampleRate);
    source.connect(audio.destination);
    source.start(0);
  } catch {
    // Best effort.
  }
}

for (const type of ['touchend', 'pointerup', 'click', 'keydown'] as const) {
  window.addEventListener(type, unlock, { capture: true, passive: true });
}

interface ToneOptions {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  /** Slide to this frequency across the tone. */
  glideTo?: number;
  delay?: number;
}

function tone({ frequency, duration, type = 'sine', gain = 0.12, glideTo, delay = 0 }: ToneOptions): void {
  const audio = ctx();
  if (!audio) return;

  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const amp = audio.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);

  // Short attack, exponential decay — a click rather than a beep.
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(amp).connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export const sfx = {
  /** Picking a tube up. */
  select(): void {
    tone({ frequency: 520, duration: 0.07, type: 'triangle', gain: 0.06 });
  },

  /** Liquid landing. Pitch rises with how much moved. */
  pour(amount: number): void {
    const base = 300 + amount * 45;
    tone({ frequency: base, glideTo: base * 1.7, duration: 0.16, type: 'sine', gain: 0.09 });
  },

  /** A tube finished. */
  complete(): void {
    tone({ frequency: 660, duration: 0.14, type: 'triangle', gain: 0.09 });
    tone({ frequency: 990, duration: 0.18, type: 'triangle', gain: 0.07, delay: 0.09 });
  },

  /** Illegal tap. Low and short — a nudge, not a buzzer. */
  reject(): void {
    tone({ frequency: 150, glideTo: 110, duration: 0.1, type: 'sawtooth', gain: 0.05 });
  },

  /**
   * A held note, for games whose sound is the information — Simon's pads each
   * have a pitch, and the tune is half of how the sequence is remembered.
   * Softer attack than the clicks above, so a run of them reads as notes.
   */
  note(frequency: number, duration: number): void {
    tone({ frequency, duration, type: 'triangle', gain: 0.13 });
  },

  /** A game lost. Longer and lower than `reject`, which is only a refused tap. */
  lose(): void {
    tone({ frequency: 130, glideTo: 82, duration: 0.55, type: 'sawtooth', gain: 0.06 });
  },

  /** Level cleared. */
  win(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => {
      tone({ frequency, duration: 0.28, type: 'triangle', gain: 0.09, delay: i * 0.085 });
    });
  },
};
