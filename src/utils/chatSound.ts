/**
 * Plays a short subtle audio beep for chat messages.
 * Uses a dedicated AudioContext completely isolated from the media player's audioEngine graph.
 */
let chatAudioCtx: AudioContext | null = null;

export function playChatNotificationSound(): void {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return;

    if (!chatAudioCtx) {
      chatAudioCtx = new AudioContextClass();
    }

    if (chatAudioCtx.state === 'suspended') {
      chatAudioCtx.resume().catch(() => {});
    }

    const now = chatAudioCtx.currentTime;
    const osc = chatAudioCtx.createOscillator();
    const gain = chatAudioCtx.createGain();

    osc.type = 'sine';
    // Pleasant two-tone chime (D5 -> A5)
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(880, now + 0.07);

    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(gain);
    gain.connect(chatAudioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.23);
  } catch (err) {
    // Autoplay or audio context initialization might be restricted
    console.debug('Chat chime restricted:', err);
  }
}
