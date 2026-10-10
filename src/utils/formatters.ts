export function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const formattedMins = mins.toString().padStart(2, '0');
  const formattedSecs = secs.toString().padStart(2, '0');

  if (hrs > 0) {
    const formattedHrs = hrs.toString();
    return `${formattedHrs}:${formattedMins}:${formattedSecs}`;
  }
  return `${formattedMins}:${formattedSecs}`;
}

export function formatTimeDetailed(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.000';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'ts', 'mts', 'm2ts', 
  'ogv', '3gp', '3g2', 'vob', 'mpg', 'mpeg', 'asf', 'rm', 'rmvb', 'divx', 'f4v'
]);

export const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'weba', 'wma', 'aiff', 'aif',
  'alac', 'mid', 'midi', 'ape', 'ac3', 'dts', 'amr'
]);

export const SUBTITLE_EXTENSIONS = new Set([
  'srt', 'vtt', 'sub', 'sbv', 'ass'
]);

export function detectMediaType(filename: string, mimeType?: string): {
  isVideo: boolean;
  isAudio: boolean;
  extension: string;
} {
  const parts = filename.split('.');
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : '';

  if (VIDEO_EXTENSIONS.has(ext)) {
    return { isVideo: true, isAudio: false, extension: ext };
  }
  if (AUDIO_EXTENSIONS.has(ext)) {
    return { isVideo: false, isAudio: true, extension: ext };
  }

  // Fallback to mimeType if extension is unknown or missing
  if (mimeType) {
    if (mimeType.startsWith('video/')) {
      return { isVideo: true, isAudio: false, extension: ext || 'video' };
    }
    if (mimeType.startsWith('audio/')) {
      return { isVideo: false, isAudio: true, extension: ext || 'audio' };
    }
  }

  // Default to video player view if unknown media
  return { isVideo: true, isAudio: false, extension: ext || 'media' };
}
