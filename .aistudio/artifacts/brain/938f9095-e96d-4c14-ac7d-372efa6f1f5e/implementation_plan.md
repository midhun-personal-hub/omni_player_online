# Implementation Plan - Dual Independent RTCPeerConnection Architecture

We will verify and document the dual independent `RTCPeerConnection` architecture where:
1. **Real-Time Video Call `RTCPeerConnection`**: Handled via `CallManager` for participant audio/video tracks with independent ICE gathering, candidate exchange, and SDP offer/answer flows (`call-signal`).
2. **Movie Streaming / Media Channel `RTCPeerConnection`**: Handled via `WatchPartyService` (`moviePeerConnections` for host and `guestMoviePc` for guest) dedicated solely to media streaming with separate ICE gathering, transport paths, and offer/answer flows (`movie-signal`).

## Verification Steps
1. Compile applet using `compile_applet`.
2. Run TypeScript linter using `lint_applet`.
3. Verify zero regressions in UI components, file sharing, and local playback.
