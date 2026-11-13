# Release notes — v0.2.8

Wemmbu now speaks while the answer is still arriving instead of waiting for the complete response. Speech is split at sentence/clause boundaries, with a short first chunk to reduce time-to-first-audio. Fish Audio generation is prefetched in parallel with strict in-order playback and a bounded three-segment buffer.

Speech-linked Explain poses begin when the first audio actually plays and remain active until the spoken queue ends. The AI can also specify bounded durations for standalone gestures. Mouth animation continues to use the real played audio's amplitude envelope. System voice fallback remains available for failed Fish Audio segments.

The app also aborts stale Fish Audio requests when the user interrupts speech.

See `SPEECH-ENGINE-0.2.8.md` for architecture and synchronization limitations, and `BUILD-STATUS-0.2.8.md` for tests and build notes.
