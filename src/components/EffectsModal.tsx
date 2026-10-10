import React, { useState } from 'react';
import { X, RotateCcw, Sliders, Volume2, Sparkles, Monitor } from 'lucide-react';
import { VideoFilters, EqualizerBand } from '../types/media';
import { EQ_PRESETS } from '../utils/audioEngine';

interface EffectsModalProps {
  isOpen: boolean;
  onClose: () => void;
  filters: VideoFilters;
  onFiltersChange: (filters: VideoFilters) => void;
  bands: EqualizerBand[];
  onBandChange: (index: number, gain: number) => void;
  onApplyEqPreset: (presetKey: string) => void;
  volumeBoost: number;
  onVolumeBoostChange: (boost: number) => void;
  isVideo: boolean;
}

export const EffectsModal: React.FC<EffectsModalProps> = ({
  isOpen,
  onClose,
  filters,
  onFiltersChange,
  bands,
  onBandChange,
  onApplyEqPreset,
  volumeBoost,
  onVolumeBoostChange,
  isVideo,
}) => {
  const [activeTab, setActiveTab] = useState<'video' | 'audio'>(isVideo ? 'video' : 'audio');

  if (!isOpen) return null;

  const defaultFilters: VideoFilters = {
    brightness: 100,
    contrast: 100,
    saturation: 100,
    hueRotate: 0,
    blur: 0,
    invert: false,
    sepia: false,
    flipHorizontal: false,
    flipVertical: false,
  };

  const handleResetVideo = () => {
    onFiltersChange({ ...defaultFilters });
  };

  const handleApplyVideoPreset = (preset: 'default' | 'vivid' | 'highContrast' | 'cinematicWarm' | 'bw') => {
    switch (preset) {
      case 'default':
        onFiltersChange({ ...defaultFilters });
        break;
      case 'vivid':
        onFiltersChange({ ...defaultFilters, brightness: 105, contrast: 115, saturation: 140 });
        break;
      case 'highContrast':
        onFiltersChange({ ...defaultFilters, brightness: 100, contrast: 135, saturation: 110 });
        break;
      case 'cinematicWarm':
        onFiltersChange({ ...defaultFilters, brightness: 102, contrast: 110, saturation: 115, sepia: true });
        break;
      case 'bw':
        onFiltersChange({ ...defaultFilters, brightness: 105, contrast: 120, saturation: 0 });
        break;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-sky-400" />
            <h2 className="text-base font-semibold text-white">Audio & Video Enhancements</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="px-6 pt-3 pb-1 border-b border-zinc-800/80 flex gap-2">
          {isVideo && (
            <button
              onClick={() => setActiveTab('video')}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'video'
                  ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span>Video Adjustments</span>
            </button>
          )}
          <button
            onClick={() => setActiveTab('audio')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
              activeTab === 'audio'
                ? 'bg-zinc-800 text-white shadow-sm border border-zinc-700/60'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            <span>Audio Equalizer & Preamp</span>
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'video' ? (
            <div className="space-y-6">
              {/* Presets */}
              <div>
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider block mb-2">
                  Color Presets
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  <button
                    onClick={() => handleApplyVideoPreset('default')}
                    className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                  >
                    Default
                  </button>
                  <button
                    onClick={() => handleApplyVideoPreset('vivid')}
                    className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                  >
                    Vivid
                  </button>
                  <button
                    onClick={() => handleApplyVideoPreset('highContrast')}
                    className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                  >
                    Contrast+
                  </button>
                  <button
                    onClick={() => handleApplyVideoPreset('cinematicWarm')}
                    className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                  >
                    Warm Tone
                  </button>
                  <button
                    onClick={() => handleApplyVideoPreset('bw')}
                    className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
                  >
                    B&W
                  </button>
                </div>
              </div>

              {/* Sliders */}
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-zinc-300 mb-1">
                    <span>Brightness</span>
                    <span className="font-mono text-zinc-400">{filters.brightness}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="160"
                    value={filters.brightness}
                    onChange={(e) => onFiltersChange({ ...filters, brightness: Number(e.target.value) })}
                    className="w-full accent-sky-400 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-zinc-300 mb-1">
                    <span>Contrast</span>
                    <span className="font-mono text-zinc-400">{filters.contrast}%</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="180"
                    value={filters.contrast}
                    onChange={(e) => onFiltersChange({ ...filters, contrast: Number(e.target.value) })}
                    className="w-full accent-sky-400 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-zinc-300 mb-1">
                    <span>Saturation</span>
                    <span className="font-mono text-zinc-400">{filters.saturation}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="200"
                    value={filters.saturation}
                    onChange={(e) => onFiltersChange({ ...filters, saturation: Number(e.target.value) })}
                    className="w-full accent-sky-400 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-zinc-300 mb-1">
                    <span>Hue Rotation</span>
                    <span className="font-mono text-zinc-400">{filters.hueRotate}°</span>
                  </div>
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    value={filters.hueRotate}
                    onChange={(e) => onFiltersChange({ ...filters, hueRotate: Number(e.target.value) })}
                    className="w-full accent-sky-400 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs text-zinc-300 mb-1">
                    <span>Blur Effect</span>
                    <span className="font-mono text-zinc-400">{filters.blur}px</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={filters.blur}
                    onChange={(e) => onFiltersChange({ ...filters, blur: Number(e.target.value) })}
                    className="w-full accent-sky-400 bg-zinc-800 h-1.5 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="pt-2 border-t border-zinc-800 grid grid-cols-2 gap-3">
                <button
                  onClick={() => onFiltersChange({ ...filters, flipHorizontal: !filters.flipHorizontal })}
                  className={`px-3 py-2 text-xs rounded-lg border text-left flex items-center justify-between transition-colors ${
                    filters.flipHorizontal
                      ? 'bg-sky-950/40 border-sky-600/50 text-sky-200'
                      : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span>Flip Horizontal</span>
                  <span className="font-mono text-[10px]">{filters.flipHorizontal ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  onClick={() => onFiltersChange({ ...filters, flipVertical: !filters.flipVertical })}
                  className={`px-3 py-2 text-xs rounded-lg border text-left flex items-center justify-between transition-colors ${
                    filters.flipVertical
                      ? 'bg-sky-950/40 border-sky-600/50 text-sky-200'
                      : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span>Flip Vertical</span>
                  <span className="font-mono text-[10px]">{filters.flipVertical ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  onClick={() => onFiltersChange({ ...filters, invert: !filters.invert })}
                  className={`px-3 py-2 text-xs rounded-lg border text-left flex items-center justify-between transition-colors ${
                    filters.invert
                      ? 'bg-sky-950/40 border-sky-600/50 text-sky-200'
                      : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span>Invert Colors</span>
                  <span className="font-mono text-[10px]">{filters.invert ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  onClick={() => onFiltersChange({ ...filters, sepia: !filters.sepia })}
                  className={`px-3 py-2 text-xs rounded-lg border text-left flex items-center justify-between transition-colors ${
                    filters.sepia
                      ? 'bg-sky-950/40 border-sky-600/50 text-sky-200'
                      : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span>Sepia Filter</span>
                  <span className="font-mono text-[10px]">{filters.sepia ? 'ON' : 'OFF'}</span>
                </button>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleResetVideo}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset All Video Effects</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Preamp Boost */}
              <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold text-zinc-200">Preamp Volume Booster</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-amber-400">
                    {Math.round(volumeBoost * 100)}%
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mb-3">
                  Boost quiet videos or recordings beyond standard 100% volume via Web Audio API Gain.
                </p>
                <input
                  type="range"
                  min="1"
                  max="2.5"
                  step="0.05"
                  value={volumeBoost}
                  onChange={(e) => onVolumeBoostChange(Number(e.target.value))}
                  className="w-full accent-amber-400 bg-zinc-800 h-2 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 font-mono mt-1">
                  <span>100% (Standard)</span>
                  <span>150%</span>
                  <span>200%</span>
                  <span>250% (Max Boost)</span>
                </div>
              </div>

              {/* EQ Presets */}
              <div>
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider block mb-2">
                  Equalizer Presets
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Object.keys(EQ_PRESETS).map((presetKey) => (
                    <button
                      key={presetKey}
                      onClick={() => onApplyEqPreset(presetKey)}
                      className="px-3 py-2 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 capitalize text-left transition-colors"
                    >
                      {presetKey.replace(/([A-Z])/g, ' $1')}
                    </button>
                  ))}
                </div>
              </div>

              {/* 5-Band Sliders */}
              <div>
                <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider block mb-4">
                  5-Band Frequency Response
                </label>
                <div className="grid grid-cols-5 gap-3 h-48 items-end p-4 bg-zinc-950/40 rounded-xl border border-zinc-800/80">
                  {bands.map((band, idx) => (
                    <div key={band.id} className="flex flex-col items-center h-full justify-between">
                      <span className="text-[11px] font-mono text-sky-400">
                        {band.gain > 0 ? `+${band.gain}` : band.gain}dB
                      </span>
                      <div className="h-28 flex items-center justify-center">
                        <input
                          type="range"
                          min="-12"
                          max="12"
                          value={band.gain}
                          onChange={(e) => onBandChange(idx, Number(e.target.value))}
                          className="h-28 w-2 accent-sky-400 -rotate-90 appearance-none cursor-pointer bg-zinc-800 rounded-lg"
                        />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 mt-2">{band.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={() => onApplyEqPreset('flat')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Equalizer (Flat)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
