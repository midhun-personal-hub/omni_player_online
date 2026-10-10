export interface MediaBookmark {
  id: string;
  time: number;
  label: string;
  createdAt: number;
}

export interface MediaItem {
  id: string;
  file?: File;
  name: string;
  url: string;
  size: number;
  type: string;
  extension: string;
  isVideo: boolean;
  isAudio: boolean;
  duration?: number;
  width?: number;
  height?: number;
  isDemo?: boolean;
  bookmarks: MediaBookmark[];
}

export interface SubtitleCue {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

export interface SubtitleTrack {
  id: string;
  name: string;
  cues: SubtitleCue[];
  delaySeconds: number; // offset in seconds (can be positive or negative)
}

export interface VideoFilters {
  brightness: number; // default 100%
  contrast: number; // default 100%
  saturation: number; // default 100%
  hueRotate: number; // default 0deg
  blur: number; // default 0px
  invert: boolean;
  sepia: boolean;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export interface EqualizerBand {
  id: string;
  freq: number;
  label: string;
  gain: number; // dB, -12 to +12
}

export type AspectRatioMode = 'original' | '16:9' | '4:3' | '21:9' | 'cover' | 'fill';

export type VisualizerMode = 'bars' | 'wave' | 'radial' | 'particles';

export type LoopMode = 'off' | 'all' | 'one';
