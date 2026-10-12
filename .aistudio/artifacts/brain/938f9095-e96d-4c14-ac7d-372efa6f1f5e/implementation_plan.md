# Revised Implementation Plan - P2P WebRTC Video Streaming & Watch Party with Local File Saving

**No code has been written.**

## 1. Understanding of Current Code
OmniPlay is a browser-only React 19 + Vite + PeerJS PWA that plays local media files. Watch Together allows a host to stream to up to 3 guests via PeerJS MediaConnection (`captureStream()`), while control messages (heartbeat every 2s, chat, play/pause/seek) run over a PeerJS DataConnection per guest, and camera/mic audio/video calls run through separate RTCPeerConnections in `callManager.ts`. The host tracks connections in `dataConnections` keyed by `conn.peer`, and `handleIncomingGuestConnection` treats incoming data connections as guests and enforces the 3-guest limit.

---

## 2. Architecture & Flow Diagram
1. **Manifest & Fingerprint**: Host generates a file fingerprint (`SHA-256` of file size + first 1 MiB + last 1 MiB) and manifest containing `pieceSize` (1 MiB), `pieceCount`, and `pieceHashes[]`.
2. **Dedicated File Channel**: When a guest connects, a second PeerJS DataConnection with `label: 'file'` is established. It is separated from control messages, does not count against the 3-guest limit, and is only accepted if the guest already has an active control connection.
3. **Storage & Resume**: Guest checks OPFS (`navigator.storage.getDirectory()`) / IndexedDB for existing partial chunks matching the fingerprint. Sends `have` message with bitmap.
4. **Chunk Transfer & Backpressure**: Host streams missing pieces using 16 KB chunks inside 1 MiB pieces with backpressure (`bufferedAmount` monitoring). Max 2 concurrent guest transfers.
5. **Verification & Storage**: Guest writes pieces to OPFS and verifies each piece's `SHA-256` against the manifest. Corrupted pieces trigger `resend`.
6. **Local Playback Switch**: Once the file is complete, verified, and decodable, the guest sets `video.src` to a local object URL from OPFS, stops the live stream, and relies solely on timestamp sync messages with drift correction.

---

## 3. Message Protocol
All new messages are validated against strict schema, role-gated, and use authenticated `conn.peer`.

| Message Type | Direction | Sender Role | Description / Fields | Validation Rules |
|--------------|-----------|-------------|----------------------|------------------|
| `manifest` | Host -> Guest | Host only | `{ fingerprint, name, size, type, duration, pieceSize, pieceCount, pieceHashes[] }` | Required fields, valid size/count |
| `have` | Guest -> Host | Guest only | `{ fingerprint, bitmap }` | Valid bitmap length matching `pieceCount` |
| `have-all` | Guest -> Host | Guest only | `{ fingerprint }` | Confirms guest already has complete file |
| `piece-start` | Host -> Guest | Host only | `{ index, size, hash }` | Valid index within bounds |
| `piece-end` | Host -> Guest | Host only | `{ index }` | Confirms chunk stream completion for piece |
| `ok` | Guest -> Host | Guest only | `{ index }` | Acknowledges successful OPFS write & hash match |
| `resend` | Guest -> Host | Guest only | `{ index }` | Requests piece re-transmission on hash mismatch |
| `priority` | Guest -> Host | Guest only | `{ indices[] }` | Reorders transfer queue for guest seek |
| `buffering` | Guest -> Host | Guest only | `{ progress, bufferedSeconds }` | Status update for download UI |
| `ready` | Guest -> Host | Guest only | `{}` | Guest ready for playback |
| `done` | Guest -> Host | Guest only | `{}` | File transfer complete |

---

## 4. Storage Design
- **OPFS (Origin Private File System)**: Primary storage (`navigator.storage.getDirectory()`). Files stored in directory `movies/{fingerprint}/`. Pieces written as individual binary parts (`piece_{index}.bin`) or a sparse file.
- **IndexedDB**: Stores movie metadata records (`fingerprint`, `name`, `size`, `type`, `duration`, `pieceSize`, `pieceCount`, `receivedPiecesBitmap`, `complete`, `lastUsed`). Fallback storage if OPFS is unavailable.
- **RAM Constraints**: Only a single 16KB chunk or 1MB piece is held in memory during transfer and verification. Never load the entire 3GB movie into RAM.
- **Quota & Persistence**: Call `navigator.storage.persist()`. Check `navigator.storage.estimate()` before transfer; if space is insufficient, abort file transfer and remain on the live stream with a warning message.

---

## 5. File-by-File Change List (Phase 1)
- `src/utils/watchParty.ts`: Add message types (`manifest`, `have`, `have-all`, `piece-start`, `piece-end`, `ok`, `resend`, `priority`, `buffering`, `ready`, `done`), validation helpers, and label-based connection routing (`control` vs `file`).
- `src/utils/p2pFileTransfer.ts` (New): Host chunk reader, backpressure management (`bufferedAmount` / `bufferedamountlow`), concurrency limiter (max 2), piece hashing worker integration.
- `src/utils/storageEngine.ts` (New): OPFS reader/writer, IndexedDB metadata store, fingerprint generator (`SHA-256` of size + first 1 MiB + last 1 MiB).
- `src/hooks/useWatchParty.ts`: Handle file transfer state, download progress, bitmap synchronization, and storage quota checks.
- `src/components/WatchTogetherModal.tsx`: Host file selection, transfer progress per guest, pause/resume transfer toggle, storage warning notices, and copyright notice.
- `src/components/GuestPlayer.tsx` & `src/components/VideoPlayer.tsx`: Download progress bar, local OPFS object URL playback switch, timestamp drift correction (< 0.3s ignore, 0.3-1.5s playbackRate adjustment, > 1.5s seek), and live stream fallback logic.

---

## 6. Risks and Open Questions
- **Codec Compatibility**: If a guest device cannot decode HEVC/AC3 locally from OPFS, local playback will fail. Mitigation: Fallback to live stream if decoding fails or stalls for > 20s.
- **Browser File System Limits**: OPFS persistence requires user permission or storage persistence API approval. Mitigation: Call `navigator.storage.persist()`.

---

## 7. Test Matrix

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Host sends a 3 GB file to 1 guest | Progress, speed and ETA update; host heartbeat and chat keep working during transfer |
| 2 | Same, with 3 guests and a 4th joining | 4th gets room-full; file channels don't use guest slots; max 2 concurrent transfers |
| 3 | Kill the guest's network mid-transfer, restore | Resumes from the bitmap with backoff, no restart from zero |
| 4 | Guest refreshes the page mid-transfer | Rejoins, sends have, only missing pieces are sent |
| 5 | A piece is corrupted in transit (simulate) | Hash mismatch, that piece is re-sent |
| 6 | Guest already has the file (same fingerprint, renamed) | have-all, no transfer, plays the local copy |
| 7 | Not enough storage / OPFS unavailable / undecodable file | Clear message and the guest stays on the live stream |
| 8 | Host tab hidden during transfer | Transfer and heartbeat still behave; warning shown if needed |
| 9 | "Pause playback while sending" checked / unchecked | Behave as specified; checkbox responds |
| 10 | Send button clicked with no guests / with guests | Disabled with a reason / starts the transfer |
| 11 | After a complete download, host seeks, pauses, changes speed | Guest local playback follows with drift correction |
| 12 | Local playback stalls over 20 s | Switches back to the live stream |
| 13 | Chat, camera/mic call and live streaming during all of the above | Unchanged |
