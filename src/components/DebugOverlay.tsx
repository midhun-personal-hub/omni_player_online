import React, { useEffect, useRef, useState } from 'react';

export const DebugOverlay: React.FC = () => {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.location.search.includes('debug=1');
  });

  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'D') {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(async () => {
      if (!statsRef.current) return;
      const moviePc = (window as any).__moviePc as RTCPeerConnection | undefined;
      if (!moviePc) {
        statsRef.current.innerText = '[Debug] No active movie RTCPeerConnection found.';
        return;
      }

      let info = `=== OmniPlay WebRTC Debug (${moviePc.connectionState}) ===\n`;
      info += `Visibility: ${document.visibilityState}\n`;

      try {
        const stats = await moviePc.getStats();
        let videoCodec = '';
        stats.forEach((report) => {
          if (report.type === 'codec' && report.mimeType?.toLowerCase().includes('video')) {
            videoCodec = report.mimeType;
          }
        });
        if (videoCodec) {
          info += `Negotiated Codec: ${videoCodec} | Mode: maintain-framerate\n`;
        }

        stats.forEach((report) => {
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            info += `[Host Outbound] Res: ${report.frameWidth}x${report.frameHeight} | FPS: ${report.framesPerSecond ?? 'N/A'} | Reason: ${report.qualityLimitationReason || 'none'}\n`;
          }
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            info += `[Guest Inbound] Res: ${report.frameWidth}x${report.frameHeight} | FPS: ${report.framesPerSecond ?? 'N/A'} | Dropped: ${report.framesDropped ?? 0} | Freeze: ${report.freezeCount ?? 0} | Lost: ${report.packetsLost ?? 0} | Jitter: ${Math.round((report.jitter ?? 0) * 1000)}ms\n`;
          }
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            info += `Available Outgoing Bitrate: ${report.availableOutgoingBitrate ? Math.round(report.availableOutgoingBitrate / 1000) + ' kbps' : 'N/A'}\n`;
          }
        });
      } catch (err) {
        info += `Stats error: ${err}\n`;
      }

      const transferDebug = (window as any).__omniplayTransferDebug;
      if (transferDebug) {
        info += `\n=== P2P File Transfer & Progressive Playback ===\n`;
        info += `Playback Mode: ${transferDebug.playbackMode}\n`;
        info += `Storage Backend: ${transferDebug.storageBackend}\n`;
        info += `Transfer Speed: ${transferDebug.transferSpeedMbps} Mbps\n`;
        info += `Pieces Done: ${transferDebug.piecesDone} / ${transferDebug.totalPieces}\n`;
        info += `Contiguous Seconds Ahead: ${transferDebug.contiguousSecondsAhead ?? 0}s\n`;
        info += `Speed vs Avg Bitrate: ${transferDebug.downloadSpeedVsAvgBitrate ?? 'N/A'}\n`;
        info += `Pending Range Requests: ${transferDebug.pendingRangeRequests ?? 0}\n`;
        info += `Service Worker Status: ${transferDebug.swStatus ?? 'inactive'}\n`;
        info += `Fallbacks Count: ${transferDebug.fallbacksCount ?? 0}\n`;
        info += `Retries: ${transferDebug.retries}\n`;
        info += `Hash Failures: ${transferDebug.hashFailures}\n`;
      }

      statsRef.current.innerText = info;
    }, 2000);

    return () => clearInterval(interval);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed top-4 left-4 z-[99999] max-w-md bg-zinc-950/90 border border-emerald-500/60 backdrop-blur-md rounded-xl p-4 shadow-2xl text-[11px] font-mono text-emerald-300 pointer-events-none select-none">
      <div className="flex items-center justify-between mb-2 pb-1 border-b border-zinc-800">
        <span className="font-bold text-white">OmniPlay Debug (?debug=1 / Ctrl+Shift+D)</span>
        <button
          onClick={() => setVisible(false)}
          className="text-zinc-400 hover:text-white pointer-events-auto px-1.5 py-0.5 rounded bg-zinc-800 text-[10px]"
        >
          Close
        </button>
      </div>
      <div ref={statsRef} className="whitespace-pre-wrap leading-relaxed">
        Gathering WebRTC stats...
      </div>
    </div>
  );
};
