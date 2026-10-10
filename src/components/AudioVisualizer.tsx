import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../utils/audioEngine';
import { VisualizerMode } from '../types/media';

interface AudioVisualizerProps {
  isPlaying: boolean;
  mode: VisualizerMode;
  title: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isPlaying, mode, title }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const freqArray = new Uint8Array(128);
    const timeArray = new Uint8Array(128);

    // Particle system state for 'particles' mode
    const particles: Array<{ x: number; y: number; vx: number; vy: number; radius: number; color: string; life: number }> = [];
    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * 800,
        y: Math.random() * 400,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        radius: Math.random() * 3 + 1,
        color: `hsl(${200 + Math.random() * 60}, 80%, 60%)`,
        life: Math.random(),
      });
    }

    let angle = 0;

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);

      const width = canvas.width;
      const height = canvas.height;

      if (isPlaying) {
        audioEngine.getFrequencyData(freqArray);
        audioEngine.getTimeDomainData(timeArray);
      } else {
        // gently decay data to zero
        for (let i = 0; i < freqArray.length; i++) {
          freqArray[i] = Math.max(0, freqArray[i] - 4);
          timeArray[i] = 128;
        }
      }

      ctx.clearRect(0, 0, width, height);

      // Deep dark backdrop with subtle radial glow
      const avg = freqArray.reduce((acc, v) => acc + v, 0) / freqArray.length;
      const glowIntensity = Math.min(0.4, (avg / 255) * 0.5);

      const bgGlow = ctx.createRadialGradient(width / 2, height / 2, 20, width / 2, height / 2, width / 2);
      bgGlow.addColorStop(0, `rgba(56, 189, 248, ${glowIntensity})`);
      bgGlow.addColorStop(0.5, `rgba(147, 51, 234, ${glowIntensity * 0.4})`);
      bgGlow.addColorStop(1, 'rgba(10, 11, 14, 0)');
      ctx.fillStyle = bgGlow;
      ctx.fillRect(0, 0, width, height);

      if (mode === 'bars') {
        const barCount = 48;
        const totalGap = (barCount - 1) * 3;
        const barWidth = Math.max(4, (width - 60 - totalGap) / barCount);
        const startX = (width - (barCount * barWidth + totalGap)) / 2;

        for (let i = 0; i < barCount; i++) {
          const dataIdx = Math.floor((i / barCount) * (freqArray.length * 0.7));
          const val = freqArray[dataIdx] || 0;
          const barHeight = Math.max(4, (val / 255) * (height * 0.65));

          const x = startX + i * (barWidth + 3);
          const y = height / 2 - barHeight / 2;

          const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
          grad.addColorStop(0, '#38bdf8');
          grad.addColorStop(0.5, '#818cf8');
          grad.addColorStop(1, '#c084fc');

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, 3);
          ctx.fill();

          // Mirror top cap
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.fillRect(x, y, barWidth, 2);
        }
      } else if (mode === 'wave') {
        ctx.beginPath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 10;

        const sliceWidth = width / timeArray.length;
        let x = 0;

        for (let i = 0; i < timeArray.length; i++) {
          const v = timeArray[i] / 128.0;
          const y = (v * height) / 2;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (mode === 'radial') {
        const cx = width / 2;
        const cy = height / 2;
        const baseRadius = Math.min(width, height) * 0.22;
        const count = 64;

        angle += 0.005;

        // Draw center vinyl core
        ctx.beginPath();
        ctx.arc(cx, cy, baseRadius * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = '#18181b';
        ctx.fill();
        ctx.strokeStyle = '#27272a';
        ctx.lineWidth = 4;
        ctx.stroke();

        for (let i = 0; i < count; i++) {
          const theta = (i / count) * Math.PI * 2 + angle;
          const dataIdx = Math.floor((i / count) * 40);
          const val = freqArray[dataIdx] || 0;
          const len = (val / 255) * 70 + 4;

          const x1 = cx + Math.cos(theta) * baseRadius;
          const y1 = cy + Math.sin(theta) * baseRadius;
          const x2 = cx + Math.cos(theta) * (baseRadius + len);
          const y2 = cy + Math.sin(theta) * (baseRadius + len);

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.strokeStyle = `hsl(${(i * 5 + 180) % 360}, 90%, 65%)`;
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      } else if (mode === 'particles') {
        const cx = width / 2;
        const cy = height / 2;

        particles.forEach((p, idx) => {
          const val = freqArray[idx % 32] || 0;
          const boost = (val / 255) * 3;

          p.x += p.vx * (1 + boost);
          p.y += p.vy * (1 + boost);

          if (p.x < 0) p.x = width;
          if (p.x > width) p.x = 0;
          if (p.y < 0) p.y = height;
          if (p.y > height) p.y = 0;

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius + boost * 2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowColor = p.color;
          ctx.shadowBlur = 8;
          ctx.fill();
        });
        ctx.shadowBlur = 0;
      }
    };

    render();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying, mode]);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-zinc-950 overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        width={900}
        height={450}
        className="w-full h-full max-h-[500px] object-contain pointer-events-none"
      />
      <div className="absolute top-6 left-6 flex items-center gap-2 text-xs font-mono text-zinc-400">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span>AUDIO SPECTRUM ENGINE</span>
      </div>
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-center pointer-events-none px-4">
        <p className="text-sm font-medium text-zinc-200 truncate max-w-md">{title}</p>
        <p className="text-xs text-zinc-500 mt-1">High-Definition Local Audio Render</p>
      </div>
    </div>
  );
};
