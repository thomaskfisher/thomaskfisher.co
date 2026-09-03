/**
 * Tiny synthesised sound. No audio files — nothing to download, nothing to
 * cache, and it keeps the whole game a few dozen kilobytes.
 *
 * Browsers refuse to start an AudioContext without a user gesture, so the
 * context is created lazily on the first tap and every call before that is a
 * no-op rather than an error.
 */

let context: AudioContext | null = null;
let enabled = true;

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

function ctx(): AudioContext | null {
  if (!enabled) return null;
  if (context) {
    // Safari suspends the context when the page is backgrounded.
    if (context.state === 'suspended') void context.resume();
    return context;
  }
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
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

  /** Level cleared. */
  win(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, i) => {
      tone({ frequency, duration: 0.28, type: 'triangle', gain: 0.09, delay: i * 0.085 });
    });
  },
};
