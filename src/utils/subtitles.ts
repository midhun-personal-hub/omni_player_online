import { SubtitleCue } from '../types/media';

function parseTimestamp(timeStr: string): number {
  const clean = timeStr.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]);
    const seconds = parseFloat(parts[1]);
    return minutes * 60 + seconds;
  }
  return 0;
}

export function parseSubtitleFile(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);

  let idCounter = 1;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines.length || lines[0].startsWith('WEBVTT') || lines[0].startsWith('NOTE')) {
      continue;
    }

    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }

    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const timeParts = timeLine.split('-->');
    if (timeParts.length < 2) continue;

    const startTime = parseTimestamp(timeParts[0]);
    const endRaw = timeParts[1].trim().split(/\s+/)[0]; // remove any position flags like align:middle
    const endTime = parseTimestamp(endRaw);

    const textLines = lines.slice(timeLineIdx + 1);
    const cleanedText = textLines
      .join('\n')
      .replace(/<[^>]*>/g, '') // remove HTML tags like <i>, <b>
      .trim();

    if (cleanedText && endTime > startTime) {
      cues.push({
        id: `cue-${idCounter++}`,
        startTime,
        endTime,
        text: cleanedText,
      });
    }
  }

  return cues;
}
