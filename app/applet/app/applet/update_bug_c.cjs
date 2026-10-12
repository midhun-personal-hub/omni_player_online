const fs = require('fs');

// 1. Update src/utils/fileTransfer.ts
const ftPath = 'src/utils/fileTransfer.ts';
let ftContent = fs.readFileSync(ftPath, 'utf8');

const targetFt = `  // Host starts transfer of file to all viewers
  public async startHostFileTransfer(
    file: File,
    guestPeerIds: string[],
    peer: any,
    mediaDuration?: number
  ) {`;

const replacementFt = `  // Host starts transfer of file to all viewers
  public async startHostFileTransfer(
    file: File,
    guestPeerIds: string[],
    peer: any,
    mediaDuration?: number,
    onHashingProgress?: (progress: { current: number; total: number }) => void
  ) {`;

if (ftContent.includes(targetFt)) {
  ftContent = ftContent.replace(targetFt, replacementFt);
  const targetLoop = `    for (let i = 0; i < pieceCount; i++) {
      const start = i * TRANSFER_PIECE_SIZE;
      const end = Math.min(file.size, start + TRANSFER_PIECE_SIZE);
      const slice = await file.slice(start, end).arrayBuffer();
      pieceHashes[i] = await computeBufferHash(slice);
    }`;

  const replacementLoop = `    for (let i = 0; i < pieceCount; i++) {
      const start = i * TRANSFER_PIECE_SIZE;
      const end = Math.min(file.size, start + TRANSFER_PIECE_SIZE);
      const slice = await file.slice(start, end).arrayBuffer();
      pieceHashes[i] = await computeBufferHash(slice);
      if (onHashingProgress && (i % 25 === 0 || i === pieceCount - 1)) {
        onHashingProgress({ current: i + 1, total: pieceCount });
        await new Promise((r) => setTimeout(r, 0));
      }
    }`;

  ftContent = ftContent.replace(targetLoop, replacementLoop);
  fs.writeFileSync(ftPath, ftContent, 'utf8');
  console.log('Successfully updated fileTransfer.ts');
} else {
  console.error('Could not find target in fileTransfer.ts');
}

// 2. Update src/hooks/useWatchParty.ts
const wpPath = 'src/hooks/useWatchParty.ts';
let wpContent = fs.readFileSync(wpPath, 'utf8');

const targetWpStart = `  const startFileTransfer = useCallback(
    async (file: File) => {
      const guestIds = watchPartyService.getGuestPeerIds();
      const peer = watchPartyService.getPeer();
      const el = getMediaElement();
      if (fileTransferManager.getPausePlaybackWhileSending() && el && !el.paused) {
        el.pause();
        broadcastCurrentState();
      }
      await fileTransferManager.startHostFileTransfer(file, guestIds, peer, el?.duration);
    },
    [getMediaElement, broadcastCurrentState]
  );`;

const replacementWpStart = `  const [pausePlaybackWhileSendingState, setPausePlaybackWhileSendingState] = useState<boolean>(() => {
    return fileTransferManager.getPausePlaybackWhileSending();
  });
  const [isPreparingTransfer, setIsPreparingTransfer] = useState<boolean>(false);
  const [hashingProgress, setHashingProgress] = useState<{ current: number; total: number } | null>(null);

  const setPausePlaybackWhileSending = useCallback((val: boolean) => {
    fileTransferManager.setPausePlaybackWhileSending(val);
    setPausePlaybackWhileSendingState(val);
  }, []);

  const startFileTransfer = useCallback(
    async (file: File) => {
      const guestIds = watchPartyService.getGuestPeerIds();
      const peer = watchPartyService.getPeer();
      const el = getMediaElement();
      if (fileTransferManager.getPausePlaybackWhileSending() && el && !el.paused) {
        el.pause();
        broadcastCurrentState();
      }
      setIsPreparingTransfer(true);
      setHashingProgress({ current: 0, total: Math.ceil(file.size / 1048576) });
      try {
        await fileTransferManager.startHostFileTransfer(
          file,
          guestIds,
          peer,
          el?.duration,
          (prog) => setHashingProgress(prog)
        );
      } catch (err) {
        console.error('[WatchParty] Failed to start file transfer:', err);
        throw err;
      } finally {
        setIsPreparingTransfer(false);
        setHashingProgress(null);
      }
    },
    [getMediaElement, broadcastCurrentState]
  );`;

const targetWpReturn = `    pausePlaybackWhileSending: fileTransferManager.getPausePlaybackWhileSending(),
    setPausePlaybackWhileSending: (val: boolean) =>
      fileTransferManager.setPausePlaybackWhileSending(val),`;

const replacementWpReturn = `    pausePlaybackWhileSending: pausePlaybackWhileSendingState,
    setPausePlaybackWhileSending,
    isPreparingTransfer,
    hashingProgress,`;

if (wpContent.includes(targetWpStart) && wpContent.includes(targetWpReturn)) {
  wpContent = wpContent.replace(targetWpStart, replacementWpStart);
  wpContent = wpContent.replace(targetWpReturn, replacementWpReturn);
  fs.writeFileSync(wpPath, wpContent, 'utf8');
  console.log('Successfully updated useWatchParty.ts');
} else {
  console.error('Could not find targets in useWatchParty.ts');
}

// 3. Update src/components/WatchTogetherModal.tsx
const modalPath = 'src/components/WatchTogetherModal.tsx';
let modalContent = fs.readFileSync(modalPath, 'utf8');

const targetModalInterface = `  pausePlaybackWhileSending?: boolean;
  onTogglePausePlaybackWhileSending?: (val: boolean) => void;
  onPlayDownloadedMovie?: (file: File) => void;
}`;

const replacementModalInterface = `  pausePlaybackWhileSending?: boolean;
  onTogglePausePlaybackWhileSending?: (val: boolean) => void;
  onPlayDownloadedMovie?: (file: File) => void;
  isPreparingTransfer?: boolean;
  hashingProgress?: { current: number; total: number } | null;
}`;

const targetModalDestructure = `  pausePlaybackWhileSending = true,
  onTogglePausePlaybackWhileSending,
  onPlayDownloadedMovie,
}) => {`;

const replacementModalDestructure = `  pausePlaybackWhileSending = true,
  onTogglePausePlaybackWhileSending,
  onPlayDownloadedMovie,
  isPreparingTransfer = false,
  hashingProgress = null,
}) => {`;

const targetModalButton = `                        ) : (
                          <button
                            type="button"
                            onClick={() => onStartFileTransfer?.(currentMediaFile)}
                            disabled={viewerCount === 0}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>
                              {viewerCount === 0
                                ? 'Wait for viewers to join room'
                                : 'Send File to Viewers'}
                            </span>
                          </button>
                        )}`;

const replacementModalButton = `                        ) : isPreparingTransfer ? (
                          <button
                            type="button"
                            disabled={true}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/40 cursor-wait"
                          >
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>
                              Preparing hashes... (\${hashingProgress ? hashingProgress.current : 0}/\${hashingProgress ? hashingProgress.total : 0} MB)
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await onStartFileTransfer?.(currentMediaFile);
                              } catch (err: any) {
                                onShowToast?.(err?.message || 'Failed to start transfer');
                              }
                            }}
                            disabled={viewerCount === 0}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>
                              {viewerCount === 0
                                ? 'Wait for viewers to join room'
                                : 'Send File to Viewers'}
                            </span>
                          </button>
                        )}`;

if (modalContent.includes(targetModalInterface) && modalContent.includes(targetModalDestructure) && modalContent.includes(targetModalButton)) {
  modalContent = modalContent.replace(targetModalInterface, replacementModalInterface);
  modalContent = modalContent.replace(targetModalDestructure, replacementModalDestructure);
  modalContent = modalContent.replace(targetModalButton, replacementModalButton);
  fs.writeFileSync(modalPath, modalContent, 'utf8');
  console.log('Successfully updated WatchTogetherModal.tsx');
} else {
  console.error('Could not find targets in WatchTogetherModal.tsx');
}
