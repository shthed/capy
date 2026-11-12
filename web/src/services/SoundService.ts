/**
 * SoundService.ts
 * Zero-asset procedural Web Audio API synthesizer for Capy.
 *
 * Design invariants:
 * - 0 KB external audio bundle weight (pure oscillator + BiquadFilter synthesis).
 * - Safe no-op fallback in Node SSR, headless environments, or restricted browsers without AudioContext.
 * - Lazy AudioContext creation/unlock strictly inside user gesture handlers.
 * - Automatic AudioContext suspension on document visibilitychange (hidden), pagehide, and window blur
 *   so backgrounded browser tabs and Android WebViews consume zero audio/CPU battery.
 * - Rate-throttled region tap woodblock/brush click (>= 25ms minimum interval) to prevent clipping
 *   during rapid Paint Mode drags.
 */

export const MIN_TAP_INTERVAL_MS = 25;
export const STREAK_RESET_IDLE_MS = 450;

/** Pre-allocated 2-octave major pentatonic semitone offsets (zero runtime array allocations) */
const PENTATONIC_STREAK_SEMITONES = new Float32Array([0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]);
export const MAX_STREAK_STEP = PENTATONIC_STREAK_SEMITONES.length - 1;
const SWATCH_CLEAR_NOTES_HZ = new Float32Array([523.25, 659.25, 783.99]); // C5 - E5 - G5
const PUZZLE_COMPLETE_NOTES_HZ = new Float32Array([523.25, 587.33, 659.25, 783.99, 1046.5]); // C5 - D5 - E5 - G5 - C6

/**
 * Computes deterministic rising major pentatonic pitch frequency (Hz) for Paint Mode streaks,
 * capped cleanly at `MAX_STREAK_STEP` so rapid drags never shriek.
 */
export function computeStreakNoteFrequency(streakStep: number, colorIndex?: number): number {
  const clampedStep = Number.isFinite(streakStep)
    ? Math.max(0, Math.min(MAX_STREAK_STEP, Math.trunc(streakStep)))
    : 0;
  const swatchSemitoneOffset =
    typeof colorIndex === 'number' && Number.isFinite(colorIndex)
      ? ((Math.abs(Math.trunc(colorIndex)) % 5) - 2) * 0.5
      : 0;
  const streakSemitoneOffset = PENTATONIC_STREAK_SEMITONES[clampedStep];
  return 340 * Math.pow(2, (swatchSemitoneOffset + streakSemitoneOffset) / 12);
}

export interface SoundConfig {
  enabled: boolean;
  volume: number;
}

type AudioContextConstructor = typeof AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as unknown as {
    AudioContext?: AudioContextConstructor;
    webkitAudioContext?: AudioContextConstructor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function clampVolume(vol: number): number {
  if (!Number.isFinite(vol)) return 0.7;
  return Math.min(1.0, Math.max(0.0, vol));
}

function resolveNowMs(nowMsOverride?: number): number {
  if (typeof nowMsOverride === 'number' && Number.isFinite(nowMsOverride)) {
    return nowMsOverride;
  }
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

class SoundServiceImpl {
  private enabled = true;
  private volume = 0.7;
  private ctx: AudioContext | null = null;
  private lastTapTimeMs = -Infinity;
  private lastStreakTapTimeMs = -Infinity;
  private streakIndex = 0;
  private lifecycleAttached = false;

  configure(config: Partial<SoundConfig>): void {
    if (typeof config.enabled === 'boolean') {
      this.enabled = config.enabled;
    }
    if (typeof config.volume === 'number') {
      this.volume = clampVolume(config.volume);
    }
    if (!this.enabled || this.volume <= 0) {
      void this.suspend();
    }
  }

  getConfig(): SoundConfig {
    return {
      enabled: this.enabled,
      volume: this.volume,
    };
  }

  /** Returns the active rising pentatonic streak index (`0` if idle `> 450ms`). */
  getStreakIndex(nowMsOverride?: number): number {
    const nowMs = resolveNowMs(nowMsOverride);
    if (nowMs - this.lastStreakTapTimeMs > STREAK_RESET_IDLE_MS) {
      return 0;
    }
    return this.streakIndex;
  }

  private ensureLifecycleListeners(): void {
    if (this.lifecycleAttached) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    this.lifecycleAttached = true;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        void this.suspend();
      }
    };
    const handleBackground = () => {
      void this.suspend();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handleBackground);
    window.addEventListener('blur', handleBackground);
  }

  private ensureUnlockedContext(): AudioContext | null {
    const AudioCtx = resolveAudioContextConstructor();
    if (!AudioCtx) return null;

    this.ensureLifecycleListeners();

    if (!this.ctx || this.ctx.state === 'closed') {
      try {
        this.ctx = new AudioCtx();
      } catch {
        this.ctx = null;
        return null;
      }
    }

    if (this.ctx.state === 'suspended') {
      try {
        void this.ctx.resume().catch(() => {
          // Ignore autoplay rejection; next user tap will retry cleanly
        });
      } catch {
        // Ignore synchronous resume errors on restricted hosts
      }
    }

    return this.ctx;
  }

  async suspend(): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === 'running') {
      try {
        await this.ctx.suspend();
      } catch {
        // Ignore suspend errors
      }
    }
  }

  resetThrottleForTesting(): void {
    this.lastTapTimeMs = -Infinity;
    this.lastStreakTapTimeMs = -Infinity;
    this.streakIndex = 0;
  }

  disposeForTesting(): void {
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        void this.ctx.close?.();
      } catch {
        // Ignore close errors
      }
    }
    this.ctx = null;
    this.lastTapTimeMs = -Infinity;
    this.lastStreakTapTimeMs = -Infinity;
    this.streakIndex = 0;
  }

  private canEmitAudio(): boolean {
    if (!this.enabled || this.volume <= 0) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;
    return true;
  }

  private scheduleWarmNote(
    ctx: AudioContext,
    freqHz: number,
    startTimeSec: number,
    durationSec: number,
    peakGainScale: number,
    waveform: OscillatorType = 'triangle'
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = waveform;
    osc.frequency.setValueAtTime(freqHz, startTimeSec);
    osc.frequency.exponentialRampToValueAtTime(freqHz * 0.996, startTimeSec + durationSec);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(2600, freqHz * 2.8), startTimeSec);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(320, freqHz * 0.9),
      startTimeSec + durationSec
    );
    filter.Q.setValueAtTime(0.8, startTimeSec);

    const peakGain = Math.max(0.0002, Math.min(0.32, this.volume * peakGainScale));
    gain.gain.setValueAtTime(0.0001, startTimeSec);
    gain.gain.linearRampToValueAtTime(peakGain, startTimeSec + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTimeSec + durationSec);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.onended = () => {
      try {
        osc.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // Ignore disconnect cleanup errors
      }
    };

    osc.start(startTimeSec);
    osc.stop(startTimeSec + durationSec + 0.005);
  }

  /**
   * Synthesizes a warm, soft ~35ms tactile woodblock/brush tap click.
   * When `isStreak` is true (e.g. Paint Mode drags), layers a rising major pentatonic pitch ladder
   * that resets automatically after `> 450ms` of gesture idle.
   */
  playRegionTap(colorIndex?: number, nowMsOverride?: number, isStreak: boolean = false): boolean {
    if (!this.canEmitAudio()) return false;

    const nowMs = resolveNowMs(nowMsOverride);
    if (nowMs - this.lastTapTimeMs < MIN_TAP_INTERVAL_MS) {
      return false;
    }

    const ctx = this.ensureUnlockedContext();
    if (!ctx) return false;

    if (nowMs - this.lastStreakTapTimeMs > STREAK_RESET_IDLE_MS) {
      this.streakIndex = 0;
    }
    const activeStreakStep = isStreak ? this.streakIndex : 0;
    if (isStreak) {
      this.streakIndex = Math.min(
        this.streakIndex + 1,
        PENTATONIC_STREAK_SEMITONES.length - 1
      );
      this.lastStreakTapTimeMs = nowMs;
    } else {
      this.streakIndex = 0;
      this.lastStreakTapTimeMs = nowMs;
    }

    this.lastTapTimeMs = nowMs;

    try {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      // Subtle organic pitch warmth across swatch numbers + rising pentatonic streak harmonic
      const startFreq = computeStreakNoteFrequency(isStreak ? activeStreakStep : 0, colorIndex);
      const pitchScale = startFreq / 340;
      const endFreq = (isStreak ? 220 : 155) * pitchScale;
      const noteDuration = isStreak ? 0.055 : 0.038;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(startFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + noteDuration - 0.003);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(Math.min(2400, 1100 * pitchScale), t0);
      filter.frequency.exponentialRampToValueAtTime(
        Math.min(1400, 380 * pitchScale),
        t0 + noteDuration
      );
      filter.Q.setValueAtTime(0.9, t0);

      const peakGain = Math.max(0.0002, Math.min(0.35, this.volume * 0.28));
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + noteDuration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.onended = () => {
        try {
          osc.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {
          // Ignore disconnect cleanup errors
        }
      };

      osc.start(t0);
      osc.stop(t0 + noteDuration + 0.004);
      return true;
    } catch {
      return false;
    }
  }

  /** Convenience helper for continuous Paint Mode rising pentatonic streak notes. */
  playPaintStreak(colorIndex?: number, nowMsOverride?: number): boolean {
    return this.playRegionTap(colorIndex, nowMsOverride, true);
  }

  /**
   * Plays a warm 3-note major arpeggio when all regions of a palette swatch are completed.
   */
  playSwatchComplete(colorIndex?: number): boolean {
    if (!this.canEmitAudio()) return false;
    const ctx = this.ensureUnlockedContext();
    if (!ctx) return false;

    try {
      const t0 = ctx.currentTime;
      const rootTranspose =
        typeof colorIndex === 'number' && Number.isFinite(colorIndex)
          ? PENTATONIC_STREAK_SEMITONES[Math.abs(Math.trunc(colorIndex)) % 5] * 0.25
          : 0;
      const transposeRatio = Math.pow(2, rootTranspose / 12);

      for (let i = 0; i < SWATCH_CLEAR_NOTES_HZ.length; i++) {
        this.scheduleWarmNote(
          ctx,
          SWATCH_CLEAR_NOTES_HZ[i] * transposeRatio,
          t0 + i * 0.055,
          0.16,
          0.22,
          'triangle'
        );
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Plays a celebratory 5-note rising pentatonic chime when 100% of puzzle regions are completed.
   */
  playPuzzleComplete(): boolean {
    if (!this.canEmitAudio()) return false;
    const ctx = this.ensureUnlockedContext();
    if (!ctx) return false;

    try {
      const t0 = ctx.currentTime;
      for (let i = 0; i < PUZZLE_COMPLETE_NOTES_HZ.length; i++) {
        const isFinal = i === PUZZLE_COMPLETE_NOTES_HZ.length - 1;
        this.scheduleWarmNote(
          ctx,
          PUZZLE_COMPLETE_NOTES_HZ[i],
          t0 + i * 0.065,
          isFinal ? 0.36 : 0.2,
          isFinal ? 0.26 : 0.21,
          isFinal ? 'sine' : 'triangle'
        );
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const SoundService = new SoundServiceImpl();

