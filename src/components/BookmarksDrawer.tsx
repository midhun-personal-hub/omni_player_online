import React, { useState } from 'react';
import { X, Bookmark, Plus, Trash2, Clock } from 'lucide-react';
import { MediaBookmark } from '../types/media';
import { formatTime } from '../utils/formatters';

interface BookmarksDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  bookmarks: MediaBookmark[];
  currentTime: number;
  onAddBookmark: (time: number, label: string) => void;
  onDeleteBookmark: (id: string) => void;
  onSeekTo: (time: number) => void;
}

export const BookmarksDrawer: React.FC<BookmarksDrawerProps> = ({
  isOpen,
  onClose,
  bookmarks,
  currentTime,
  onAddBookmark,
  onDeleteBookmark,
  onSeekTo,
}) => {
  const [newLabel, setNewLabel] = useState('');

  if (!isOpen) return null;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim() || `Bookmark @ ${formatTime(currentTime)}`;
    onAddBookmark(currentTime, label);
    setNewLabel('');
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-zinc-900 border-l border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-sky-400" />
          <h2 className="text-sm font-semibold text-white">Bookmarks & Chapters</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Add current time bookmark */}
      <form onSubmit={handleAdd} className="p-4 border-b border-zinc-800/80 bg-zinc-950/40 space-y-2">
        <div className="flex items-center justify-between text-xs text-zinc-400">
          <span>Current Timestamp</span>
          <span className="font-mono text-sky-400 font-semibold">{formatTime(currentTime)}</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Label (e.g. Favorite scene)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="flex-1 px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Mark</span>
          </button>
        </div>
      </form>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {bookmarks.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-center p-4">
            <Bookmark className="w-8 h-8 text-zinc-700 mb-2" />
            <p className="text-xs text-zinc-400 font-medium">No bookmarks saved yet</p>
            <p className="text-[11px] text-zinc-600 mt-1">
              Press <kbd className="px-1.5 py-0.5 font-mono bg-zinc-800 rounded text-zinc-400">B</kbd> or mark the timestamp above to save key moments.
            </p>
          </div>
        ) : (
          bookmarks
            .slice()
            .sort((a, b) => a.time - b.time)
            .map((b) => (
              <div
                key={b.id}
                className="group flex items-center justify-between p-2.5 rounded-lg bg-zinc-950/50 hover:bg-zinc-800/70 border border-zinc-800/60 transition-colors"
              >
                <button
                  onClick={() => onSeekTo(b.time)}
                  className="flex-1 min-w-0 text-left flex items-center gap-2.5"
                >
                  <div className="p-1 rounded bg-zinc-800 text-sky-400">
                    <Clock className="w-3.5 h-3.5" />
                  </div>
                  <div className="truncate">
                    <p className="text-xs font-medium text-zinc-200 group-hover:text-white truncate">{b.label}</p>
                    <span className="text-[10px] font-mono text-sky-400">{formatTime(b.time)}</span>
                  </div>
                </button>
                <button
                  onClick={() => onDeleteBookmark(b.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-500 hover:text-rose-400 rounded-md transition-opacity"
                  title="Delete bookmark"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
};
