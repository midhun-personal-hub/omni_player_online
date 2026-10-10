import React, { useRef } from 'react';
import {
  Film,
  Music,
  FolderOpen,
  FilePlus,
  ShieldCheck,
  Zap,
  Sparkles,
  Sliders,
  Layers,
} from 'lucide-react';
import { MediaItem } from '../types/media';
import { createDemoAudio, createDemoVideo } from '../utils/demoMedia';

interface EmptyStateProps {
  onAddFiles: (files: FileList | File[]) => void;
  onLoadMediaItem: (item: MediaItem) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onAddFiles, onLoadMediaItem }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  const handleLoadDemoAudio = async () => {
    const audio = await createDemoAudio();
    onLoadMediaItem(audio);
  };

  const handleLoadDemoVideo = async () => {
    const video = await createDemoVideo();
    onLoadMediaItem(video);
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-950 text-white min-h-full py-8 select-none"
    >
      <div className="w-full max-w-2xl text-center space-y-6">
        {/* Brand Icon & Headline */}
        <div className="space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl text-sky-400 mx-auto">
            <Film className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Play Any Video or Audio Locally
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-lg mx-auto">
            Choose any local video or audio file to start instant playback with cinema-grade dark
            interface, audio visualizers, and zero upload wait times.
          </p>
        </div>

        {/* Dropzone Card */}
        <div className="border-2 border-dashed border-zinc-800 hover:border-sky-500/60 rounded-3xl p-8 sm:p-10 bg-zinc-900/40 backdrop-blur-md transition-all space-y-6">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept="video/*,audio/*,.mkv,.avi,.flv,.wmv,.mov,.ts,.3gp,.opus,.weba,.m4v"
              onChange={handleFileInput}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold text-sm transition-all shadow-lg active:scale-95"
            >
              <FilePlus className="w-4 h-4" />
              <span>Choose Media Files</span>
            </button>

            <input
              type="file"
              ref={folderInputRef}
              // @ts-expect-error webkitdirectory is standard for directory picker
              webkitdirectory="true"
              directory="true"
              onChange={handleFileInput}
              className="hidden"
            />
            <button
              onClick={() => folderInputRef.current?.click()}
              className="flex items-center gap-2 px-5 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-sm transition-all border border-zinc-700/80 active:scale-95"
            >
              <FolderOpen className="w-4 h-4 text-amber-400" />
              <span>Choose Folder</span>
            </button>
          </div>

          <p className="text-xs text-zinc-500">
            or drag and drop your media files anywhere onto this window
          </p>

          {/* Quick Demo Launchers */}
          <div className="pt-4 border-t border-zinc-800/80">
            <span className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider block mb-3">
              Don't have a file right now? Test with instant samples:
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={handleLoadDemoVideo}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 text-xs text-zinc-300 border border-zinc-700/60 transition-colors"
              >
                <Film className="w-3.5 h-3.5 text-sky-400" />
                <span>Test Video (4K Pattern)</span>
              </button>
              <button
                onClick={handleLoadDemoAudio}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-800 text-xs text-zinc-300 border border-zinc-700/60 transition-colors"
              >
                <Music className="w-3.5 h-3.5 text-indigo-400" />
                <span>Test Audio (Synthwave Track)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
          <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/60">
            <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold mb-1">
              <Zap className="w-3.5 h-3.5" />
              <span>Universal Format</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              MP4, MKV, WebM, AVI, MOV, FLV, MP3, WAV, FLAC, M4A, etc.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/60">
            <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Audio Visualizer</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Interactive 60FPS frequency spectrum, wave & radial modes.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/60">
            <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold mb-1">
              <Sliders className="w-3.5 h-3.5" />
              <span>250% Preamp EQ</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Volume booster for quiet tracks and 5-band custom equalizer.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/60">
            <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold mb-1">
              <Layers className="w-3.5 h-3.5" />
              <span>Subtitles & FX</span>
            </div>
            <p className="text-[11px] text-zinc-400">
              External SRT/VTT parser, color grading, snapshots & A-B loop.
            </p>
          </div>
        </div>

        {/* Security & Local Storage Guarantee */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/70 border border-zinc-800 text-zinc-400 text-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>100% Client-side local playback. No files are ever uploaded.</span>
        </div>
      </div>
    </div>
  );
};
