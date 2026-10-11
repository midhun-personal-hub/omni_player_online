# Implementation Plan - OmniPlay Watch-Together Smoothness & Diagnostics

## Files & Functions to Touch
1. **`src/utils/watchParty.ts`**:
   - `captureStream(30)` + `contentHint = "motion"`
   - Sender parameters (`maintain-framerate`, `maxFramerate = 30`, dynamic `scaleResolutionDownBy`, presets: Smooth 720p ~2.5M, Balanced 720p ~3.5M, High 1080p ~6M)
   - Codec preference: H264 first, then VP8, VP9 last
   - Slideshow guard & adaptive step-down/step-up based on outbound FPS & stats
   - Visibility change toast & WakeLock API (`navigator.wakeLock.request('screen')`)
   - Guest jitter buffer target smoothing (`receiver.jitterBufferTarget = 500ms` up to 1500ms)
   - Expose `window.__moviePc` when `?debug=1`
2. **`src/utils/callManager.ts`**:
   - Camera getUserMedia constraints (640x360, 24fps)
   - Call sender parameters (`maxBitrate = 400_000`, `maxFramerate = 24`, `maintain-framerate`, `contentHint = "motion"`, mic 32kbps high priority)
   - Bandwidth sharing (~400 kbps reduction on movie when call starts, restore when call ends)
   - Fast first video / keyframe request
3. **UI / Components (`src/App.tsx`, `src/components/VideoPlayer.tsx`, `GuestPlayer.tsx`, etc.)**:
   - Host movie video element: keep in viewport with `opacity: 0.01` (never display:none / hidden)
   - Quality selector (Smooth / Balanced / High)
   - Debug overlay (hidden by default, toggled via `?debug=1` or `Ctrl+Shift+D`, updating every 2s via refs)

## Verification Plan
- Compile applet (`compile_applet`) and run linter (`lint_applet`).
- Verify smooth playback, quality selector, wake lock, and debug overlay.
