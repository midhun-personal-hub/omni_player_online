import React, { useRef, useState } from 'react';
import {
  X,
  ListMusic,
  FolderOpen,
  FilePlus,
  Trash2,
  Search,
  Video,
  Music,
  Play,
  Shuffle,
  Repeat,
  Repeat1,
} from 'lucide-react';
import { MediaItem, LoopMode } from '../types/media';
import { formatFileSize, formatTime } from '../utils/formatters';

interface PlaylistDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  playlist: MediaItem[];
  currentIndex: number;
  onSelectTrack: (index: number) => void;
  onRemoveTrack: (id: string) => void;
  onClearPlaylist: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  loopMode: LoopMode;
  onToggleLoop: () => void;
  isShuffle: boolean;
  onToggleShuffle: () => void;
}

export const PlaylistDrawer: React.FC<PlaylistDrawerProps> = ({
  isOpen,
  onClose,
  playlist,
  currentIndex,
  onSelectTrack,
  onRemoveTrack,
  onClearPlaylist,
  onAddFiles,
  loopMode,
  onToggleLoop,
  isShuffle,
  onToggleShuffle,
}) => {
  const [filterType, setFilterType] = useState<'all' | 'video' | 'audio'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const filteredPlaylist = playlist.filter((item) => {
    if (filterType === 'video' && !item.isVideo) return false;
    if (filterType === 'audio' && !item.isAudio) return false;
    if (searchQuery.trim() && !item.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(e.target.files);
      e.target.value = '';
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

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
    >
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListMusic className="w-5 h-5 text-sky-400" />
          <h2 className="text-sm font-semibold text-white">Media Queue ({playlist.length})</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Action Bar */}
      <div className="p-3 border-b border-zinc-800 bg-zinc-950/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept="video/*,audio/*,.mkv,.avi,.flv,.wmv,.mov,.ts,.3gp,.opus,.weba"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            title="Add local media files"
          >
            <FilePlus className="w-3.5 h-3.5 text-sky-400" />
            <span>Files</span>
          </button>

          <input
            type="file"
            ref={folderInputRef}
            // @ts-expect-error webkitdirectory is standard for directory picker
            webkitdirectory="true"
            directory="true"
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            onClick={() => folderInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            title="Import an entire folder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
            <span>Folder</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onToggleShuffle}
            className={`p-1.5 rounded-lg transition-colors ${
              isShuffle ? 'bg-sky-950/60 text-sky-400 border border-sky-600/40' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            title={isShuffle ? 'Shuffle: ON' : 'Shuffle: OFF'}
          >
            <Shuffle className="w-4 h-4" />
          </button>

          <button
            onClick={onToggleLoop}
            className={`p-1.5 rounded-lg transition-colors ${
              loopMode !== 'off'
                ? 'bg-sky-950/60 text-sky-400 border border-sky-600/40'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            title={`Loop Mode: ${loopMode.toUpperCase()}`}
          >
            {loopMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </button>

          {playlist.length > 0 && (
            <button
              onClick={onClearPlaylist}
              className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 rounded-lg transition-colors ml-1"
              title="Clear entire playlist"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search */}
      <div className="p-3 border-b border-zinc-800/80 space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search playlist..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-zinc-950/80 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-zinc-950/80 rounded-lg">
          <button
            onClick={() => setFilterType('all')}
            className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
              filterType === 'all' ? 'bg-zinc-800 text-white shadow-xs' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            All ({playlist.length})
          </button>
          <button
            onClick={() => setFilterType('video')}
            className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
              filterType === 'video' ? 'bg-zinc-800 text-white shadow-xs' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Videos
          </button>
          <button
            onClick={() => setFilterType('audio')}
            className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-colors ${
              filterType === 'audio' ? 'bg-zinc-800 text-white shadow-xs' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Audio
          </button>
        </div>
      </div>

      {/* Playlist Items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {filteredPlaylist.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center p-4">
            <ListMusic className="w-8 h-8 text-zinc-700 mb-2" />
            <p className="text-xs text-zinc-400 font-medium">Playlist is empty</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Drag & drop media files here or click "Files" to add.
            </p>
          </div>
        ) : (
          filteredPlaylist.map((item) => {
            const originalIndex = playlist.findIndex((p) => p.id === item.id);
            const isPlaying = originalIndex === currentIndex;

            return (
              <div
                key={item.id}
                className={`group flex items-center justify-between p-2 rounded-xl transition-all ${
                  isPlaying
                    ? 'bg-sky-950/40 border border-sky-600/40 text-white'
                    : 'bg-zinc-950/40 hover:bg-zinc-800/60 border border-zinc-800/50 text-zinc-300'
                }`}
              >
                <button
                  onClick={() => onSelectTrack(originalIndex)}
                  className="flex-1 min-w-0 text-left flex items-center gap-2.5"
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isPlaying
                        ? 'bg-sky-500 text-zinc-950'
                        : 'bg-zinc-800 text-zinc-400 group-hover:text-zinc-200'
                    }`}
                  >
                    {isPlaying ? (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    ) : item.isVideo ? (
                      <Video className="w-3.5 h-3.5" />
                    ) : (
                      <Music className="w-3.5 h-3.5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{item.name}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono mt-0.5">
                      <span className="uppercase text-zinc-400">{item.extension}</span>
                      <span>·</span>
                      <span>{formatFileSize(item.size)}</span>
                      {item.duration && (
                        <>
                          <span>·</span>
                          <span>{formatTime(item.duration)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => onRemoveTrack(item.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-500 hover:text-rose-400 rounded-md transition-opacity"
                  title="Remove from queue"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 bg-zinc-950/60 border-t border-zinc-800 text-center">
        <p className="text-[11px] text-zinc-500">
          Drop files or folders anytime to add to queue · Zero uploading
        </p>
      </div>
    </div>
  );
};
