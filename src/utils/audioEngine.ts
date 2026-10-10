import { EqualizerBand } from '../types/media';

export const DEFAULT_EQ_BANDS: EqualizerBand[] = [
  { id: '60hz', freq: 60, label: '60 Hz', gain: 0 },
  { id: '250hz', freq: 250, label: '250 Hz', gain: 0 },
  { id: '1khz', freq: 1000, label: '1 kHz', gain: 0 },
  { id: '4khz', freq: 4000, label: '4 kHz', gain: 0 },
  { id: '12khz', freq: 12000, label: '12 kHz', gain: 0 },
];

export const EQ_PRESETS: Record<string, number[]> = {
  flat: [0, 0, 0, 0, 0],
  bassBoost: [6, 4, 1, 0, -1],
  vocalEnhance: [-2, 1, 4, 3, 1],
  trebleBoost: [-1, 0, 1, 4, 6],
  movieCinema: [5, 2, -1, 3, 4],
  electronic: [5, 3, -1, 2, 4],
  rock: [4, 2, -1, 2, 5],
};

class AudioEngine {
  private ctx: AudioContext | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private currentElement: HTMLMediaElement | null = null;
  private analyser: AnalyserNode | null = null;
  private preampGain: GainNode | null = null;
  private filterNodes: BiquadFilterNode[] = [];
  private streamDest: MediaStreamAudioDestinationNode | null = null;

  public init(mediaElement: HTMLMediaElement) {
    if (this.currentElement === mediaElement && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }

    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx) {
        this.ctx = new AudioCtxClass();
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }

      // Check if media element already has a source attached
      if (this.currentElement !== mediaElement) {
        this.currentElement = mediaElement;
        
        // Disconnect existing filters if any
        this.filterNodes.forEach((node) => node.disconnect());
        this.filterNodes = [];
        if (this.preampGain) this.preampGain.disconnect();
        if (this.analyser) this.analyser.disconnect();
        if (this.source) {
          try {
            this.source.disconnect();
          } catch {
            // ignore
          }
        }

        try {
          this.source = this.ctx.createMediaElementSource(mediaElement);
        } catch {
          // If already connected, createMediaElementSource may throw; retain reference
        }

        // Create 5 EQ filters
        let previousNode: AudioNode | null = this.source;

        this.filterNodes = DEFAULT_EQ_BANDS.map((band, idx) => {
          const filter = this.ctx!.createBiquadFilter();
          if (idx === 0) {
            filter.type = 'lowshelf';
          } else if (idx === DEFAULT_EQ_BANDS.length - 1) {
            filter.type = 'highshelf';
          } else {
            filter.type = 'peaking';
            filter.Q.value = 1.2;
          }
          filter.frequency.value = band.freq;
          filter.gain.value = band.gain;

          if (previousNode) {
            previousNode.connect(filter);
          }
          previousNode = filter;
          return filter;
        });

        // Preamp Gain Node (for volume boost up to 250%)
        this.preampGain = this.ctx.createGain();
        this.preampGain.gain.value = 1.0;
        if (previousNode) {
          previousNode.connect(this.preampGain);
        }

        // Analyser Node for visualizer
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.8;
        this.preampGain.connect(this.analyser);

        // Connect to speaker destination
        this.analyser.connect(this.ctx.destination);

        // Connect to WebRTC capture stream destination (preserves EQ & boost for peers)
        if (!this.streamDest) {
          this.streamDest = this.ctx.createMediaStreamDestination();
        }
        this.analyser.connect(this.streamDest);
      }
    } catch (e) {
      console.warn('AudioEngine initialization error:', e);
    }
  }

  public getCaptureAudioTrack(): MediaStreamTrack | null {
    if (!this.streamDest) return null;
    const tracks = this.streamDest.stream.getAudioTracks();
    return tracks.length > 0 ? tracks[0] : null;
  }

  public resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setBoost(multiplier: number) {
    if (this.preampGain && this.ctx) {
      // multiplier can range from 1.0 (normal) to 2.5 (250%)
      this.preampGain.gain.setTargetAtTime(Math.max(0.1, multiplier), this.ctx.currentTime, 0.05);
    }
  }

  public setBandGain(index: number, gainDb: number) {
    if (this.filterNodes[index] && this.ctx) {
      this.filterNodes[index].gain.setTargetAtTime(gainDb, this.ctx.currentTime, 0.05);
    }
  }

  public applyPreset(gains: number[]) {
    gains.forEach((g, idx) => {
      this.setBandGain(idx, g);
    });
  }

  public getFrequencyData(array: Uint8Array): void {
    if (this.analyser) {
      this.analyser.getByteFrequencyData(array as unknown as Uint8Array<ArrayBuffer>);
    }
  }

  public getTimeDomainData(array: Uint8Array): void {
    if (this.analyser) {
      this.analyser.getByteTimeDomainData(array as unknown as Uint8Array<ArrayBuffer>);
    }
  }
}

export const audioEngine = new AudioEngine();
