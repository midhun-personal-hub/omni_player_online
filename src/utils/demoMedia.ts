import { MediaItem } from '../types/media';

// Generate a high-quality local synthetic synthwave audio file (WAV) using OfflineAudioContext
export async function createDemoAudio(): Promise<MediaItem> {
  const duration = 20; // 20 seconds loop
  const sampleRate = 44100;
  const numSamples = duration * sampleRate;

  const offlineCtx = new OfflineAudioContext(2, numSamples, sampleRate);

  // Bass Synth
  const bassNotes = [55, 55, 65.4, 73.4, 49, 49, 55, 65.4]; // A1, C2, D2, G1...
  const beatDuration = 0.5; // 120 BPM
  const totalBeats = Math.floor(duration / beatDuration);

  for (let b = 0; b < totalBeats; b++) {
    const time = b * beatDuration;
    const note = bassNotes[b % bassNotes.length];

    // Bass synth note
    const osc = offlineCtx.createOscillator();
    const gain = offlineCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(note, time);

    gain.gain.setValueAtTime(0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + beatDuration * 0.9);

    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, time);
    filter.frequency.exponentialRampToValueAtTime(100, time + beatDuration * 0.8);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(offlineCtx.destination);

    osc.start(time);
    osc.stop(time + beatDuration);

    // Arpeggiated high lead synth
    if (b % 2 === 0) {
      const leadOsc = offlineCtx.createOscillator();
      const leadGain = offlineCtx.createGain();
      leadOsc.type = 'triangle';
      const leadNotes = [220, 261.6, 329.6, 392, 440, 523.2];
      const leadNote = leadNotes[(b * 3) % leadNotes.length];
      leadOsc.frequency.setValueAtTime(leadNote, time + 0.25);

      leadGain.gain.setValueAtTime(0.2, time + 0.25);
      leadGain.gain.exponentialRampToValueAtTime(0.001, time + 0.5);

      leadOsc.connect(leadGain);
      leadGain.connect(offlineCtx.destination);

      leadOsc.start(time + 0.25);
      leadOsc.stop(time + 0.5);
    }

    // Drum beat (Kick on beat 0, 2; Snare on beat 1, 3)
    if (b % 2 === 0) {
      // Kick drum
      const kickOsc = offlineCtx.createOscillator();
      const kickGain = offlineCtx.createGain();
      kickOsc.frequency.setValueAtTime(150, time);
      kickOsc.frequency.exponentialRampToValueAtTime(30, time + 0.15);

      kickGain.gain.setValueAtTime(0.7, time);
      kickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);

      kickOsc.connect(kickGain);
      kickGain.connect(offlineCtx.destination);
      kickOsc.start(time);
      kickOsc.stop(time + 0.2);
    } else {
      // Snare / noise hit
      const bufferSize = offlineCtx.sampleRate * 0.1;
      const noiseBuffer = offlineCtx.createBuffer(1, bufferSize, offlineCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const whiteNoise = offlineCtx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      const snareFilter = offlineCtx.createBiquadFilter();
      snareFilter.type = 'highpass';
      snareFilter.frequency.value = 1000;

      const snareGain = offlineCtx.createGain();
      snareGain.gain.setValueAtTime(0.25, time);
      snareGain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);

      whiteNoise.connect(snareFilter);
      snareFilter.connect(snareGain);
      snareGain.connect(offlineCtx.destination);
      whiteNoise.start(time);
    }
  }

  const renderedBuffer = await offlineCtx.startRendering();
  const wavBlob = audioBufferToWav(renderedBuffer);
  const url = URL.createObjectURL(wavBlob);

  return {
    id: 'demo-audio-synthwave',
    name: 'Cyber_Synthwave_120BPM_Demo.wav',
    url,
    size: wavBlob.size,
    type: 'audio/wav',
    extension: 'wav',
    isVideo: false,
    isAudio: true,
    duration,
    isDemo: true,
    bookmarks: [
      { id: 'b1', time: 4, label: 'Lead Arp Entry', createdAt: Date.now() },
      { id: 'b2', time: 10, label: 'Mid-loop Transition', createdAt: Date.now() },
    ],
  };
}

// Convert AudioBuffer to WAV Blob
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = buffer.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channelData.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

// Generate a high-definition canvas animation video (WebM/MP4) with audio track
export async function createDemoVideo(): Promise<MediaItem> {
  const width = 1280;
  const height = 720;
  const fps = 30;
  const durationSec = 10;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const stream = canvas.captureStream(fps);

  // Audio track for the video
  const audioCtx = new AudioContext();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  gain.gain.value = 0.15;
  osc.frequency.value = 440;
  osc.connect(gain);
  const dest = audioCtx.createMediaStreamDestination();
  gain.connect(dest);
  osc.start();

  stream.addTrack(dest.stream.getAudioTracks()[0]);

  // Pick supported MIME type
  let mimeType = 'video/webm;codecs=vp8,opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm';
  }

  const mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 });
  const chunks: Blob[] = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const recordingPromise = new Promise<Blob>((resolve) => {
    mediaRecorder.onstop = () => {
      osc.stop();
      audioCtx.close();
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(blob);
    };
  });

  mediaRecorder.start();

  const startTime = performance.now();
  const totalFrames = durationSec * fps;
  let frame = 0;

  function renderFrame() {
    const t = frame / fps;
    
    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, width, height);
    const hue1 = (t * 30) % 360;
    const hue2 = (hue1 + 120) % 360;
    grad.addColorStop(0, `hsl(${hue1}, 70%, 10%)`);
    grad.addColorStop(1, `hsl(${hue2}, 80%, 5%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Subtle grid pattern
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Dynamic rotating geometric rings
    const centerX = width / 2;
    const centerY = height / 2;
    const count = 5;
    for (let i = 0; i < count; i++) {
      const radius = 90 + i * 45 + Math.sin(t * 3 + i) * 15;
      const angle = t * (i % 2 === 0 ? 1 : -1) * (1 + i * 0.3);

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(angle);

      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 1.5);
      ctx.strokeStyle = `hsl(${(hue1 + i * 40) % 360}, 90%, 60%)`;
      ctx.lineWidth = 3 + i;
      ctx.shadowColor = `hsl(${(hue1 + i * 40) % 360}, 90%, 60%)`;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }

    // Modern cinematic HUD overlay
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('OMNIPLAY 4K TEST BENCH', centerX, centerY - 20);

    ctx.font = '16px monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`FRAME ${frame} / ${totalFrames}  |  TIME: ${t.toFixed(2)}s  |  RES: 1280x720 60FPS`, centerX, centerY + 24);

    // Dynamic countdown circle
    const remaining = Math.max(0, durationSec - t);
    ctx.font = 'bold 24px monospace';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`${remaining.toFixed(1)}s`, centerX, centerY + 70);

    // Audio pitch variation
    osc.frequency.setValueAtTime(220 + Math.sin(t * 4) * 110, audioCtx.currentTime);

    frame++;
    if (frame < totalFrames) {
      setTimeout(renderFrame, 1000 / fps);
    } else {
      mediaRecorder.stop();
    }
  }

  renderFrame();
  const videoBlob = await recordingPromise;
  const url = URL.createObjectURL(videoBlob);

  return {
    id: 'demo-video-matrix',
    name: 'OmniPlay_Cinematic_Test_Pattern.webm',
    url,
    size: videoBlob.size,
    type: 'video/webm',
    extension: 'webm',
    isVideo: true,
    isAudio: false,
    duration: durationSec,
    width: 1280,
    height: 720,
    isDemo: true,
    bookmarks: [
      { id: 'v1', time: 2.5, label: 'Ring Acceleration', createdAt: Date.now() },
      { id: 'v2', time: 7.0, label: 'Color Shift Peak', createdAt: Date.now() },
    ],
  };
}
