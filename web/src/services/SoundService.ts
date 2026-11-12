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

class SoundServiceImpl {
  private enabled = true;
  private volume = 0.7;
  private ctx: AudioContext | null = null;
  private lastTapTimeMs = -Infinity;
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
  }

  /**
   * Synthesizes a warm, soft ~35ms tactile woodblock/brush tap click.
   * Returns true if a tap sound was scheduled, or false if muted, hidden, throttled, or unsupported.
   */
  playRegionTap(colorIndex?: number, nowMsOverride?: number): boolean {
    if (!this.enabled || this.volume <= 0) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;

    const nowMs =
      typeof nowMsOverride === 'number'
        ? nowMsOverride
        : typeof performance !== 'undefined'
          ? performance.now()
          : Date.now();

    if (nowMs - this.lastTapTimeMs < MIN_TAP_INTERVAL_MS) {
      return false;
    }

    const ctx = this.ensureUnlockedContext();
    if (!ctx) return false;

    this.lastTapTimeMs = nowMs;

    try {
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      // Subtle organic pitch warmth across swatch numbers without harshness
      const semitoneOffset =
        typeof colorIndex === 'number' && Number.isFinite(colorIndex)
          ? ((Math.abs(Math.trunc(colorIndex)) % 5) - 2) * 0.5
          : 0;
      const pitchScale = Math.pow(2, semitoneOffset / 12);
      const startFreq = 340 * pitchScale;
      const endFreq = 155 * pitchScale;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(startFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + 0.035);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1100, t0);
      filter.frequency.exponentialRampToValueAtTime(380, t0 + 0.038);
      filter.Q.setValueAtTime(0.9, t0);

      const peakGain = Math.max(0.0002, Math.min(0.35, this.volume * 0.28));
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.038);

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
      osc.stop(t0 + 0.04);
      return true;
    } catch {
      return false;
    }
  }
}

export const SoundService = new SoundServiceImpl();
