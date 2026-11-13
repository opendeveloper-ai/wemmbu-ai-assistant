/**
 * Reuses one Web Audio graph for the lifetime of the assistant. Each Fish Audio
 * chunk is connected to the same analyser, then disconnected when that chunk ends.
 * The analyser is connected to the normal output path so speech remains audible.
 */
export function createSpeechAudioController(levelRef, modeRef, timelineRef = null) {
  let audioContext = null;
  let analyser = null;
  let timeDomainData = null;
  let frequencyData = null;
  let animationFrame = 0;
  let previousFrameTime = 0;
  let smoothedLevel = 0;
  const activeSources = new Set();
  let activeMediaElement = null;

  function disconnectSources() {
    activeSources.forEach((source) => {
      try { source.disconnect(); } catch { /* A source may already have ended. */ }
    });
    activeSources.clear();
  }

  function stopSampling() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previousFrameTime = 0;
    smoothedLevel = 0;
    levelRef.current = 0;
  }

  function endSpeech() {
    modeRef.current = 'idle';
    stopSampling();
    disconnectSources();
    activeMediaElement = null;
    if (timelineRef) timelineRef.current = { ...(timelineRef.current || {}), sessionActive: false, isPlaying: false, mediaTime: 0, duration: 0, provider: 'idle' };
  }

  function ensureAudioGraph() {
    if (typeof window === 'undefined') return false;
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return false;

    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContextConstructor({ latencyHint: 'interactive' });
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      timeDomainData = new Uint8Array(analyser.fftSize);
      frequencyData = new Uint8Array(analyser.frequencyBinCount);
      // Keep the ordinary audio output intact; the analyser is in the same output path.
      analyser.connect(audioContext.destination);
    }
    return true;
  }

  function prepare() {
    try {
      if (!ensureAudioGraph()) return false;
      // Call this synchronously from the user's Send/Read Aloud gesture when possible.
      // The graph is then already unlocked by the time a Fish Audio request returns.
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      return true;
    } catch (error) {
      console.warn('[SpeechAudioController] Could not prepare the audio analyser; playback will use the non-analysed fallback.', error);
      modeRef.current = 'native';
      return false;
    }
  }

  function sampleAudio(now) {
    animationFrame = 0;
    if (modeRef.current !== 'fish' || !analyser || !timeDomainData || !frequencyData) return;

    if (activeMediaElement && timelineRef) {
      timelineRef.current = {
        ...(timelineRef.current || {}),
        sessionActive: timelineRef.current?.sessionActive !== false,
        isPlaying: !activeMediaElement.paused && !activeMediaElement.ended,
        mediaTime: Number(activeMediaElement.currentTime) || 0,
        duration: Number.isFinite(activeMediaElement.duration) ? activeMediaElement.duration : 0,
        provider: 'fish',
        audioContextTime: audioContext?.currentTime || 0,
      };
    }
    analyser.getByteTimeDomainData(timeDomainData);
    analyser.getByteFrequencyData(frequencyData);

    let squareSum = 0;
    for (let index = 0; index < timeDomainData.length; index += 1) {
      const centered = (timeDomainData[index] - 128) / 128;
      squareSum += centered * centered;
    }
    const rms = Math.sqrt(squareSum / timeDomainData.length);

    // A light high-frequency weighting helps consonant bursts register without
    // pretending to identify phonemes or visemes.
    let allEnergy = 0;
    let highEnergy = 0;
    const maxBin = Math.min(150, frequencyData.length);
    for (let index = 2; index < maxBin; index += 1) {
      const energy = frequencyData[index];
      allEnergy += energy;
      if (index >= 22) highEnergy += energy;
    }
    const highFrequencyRatio = allEnergy > 0 ? highEnergy / allEnergy : 0;
    const amplitude = Math.max(0, (rms - 0.018) * 5.8);
    const target = Math.max(0, Math.min(1, amplitude * (0.84 + highFrequencyRatio * 0.38)));

    const dt = previousFrameTime ? Math.min((now - previousFrameTime) / 1000, 0.05) : 1 / 60;
    previousFrameTime = now;
    const rate = target > smoothedLevel ? 23 : 10.5;
    smoothedLevel += (target - smoothedLevel) * (1 - Math.exp(-rate * dt));
    if (smoothedLevel < 0.012) smoothedLevel = 0;
    levelRef.current = smoothedLevel;

    animationFrame = requestAnimationFrame(sampleAudio);
  }

  function startSampling() {
    if (animationFrame) return;
    previousFrameTime = 0;
    animationFrame = requestAnimationFrame(sampleAudio);
  }

  function attachAudio(audio) {
    stopSampling();
    disconnectSources();
    modeRef.current = 'native';

    try {
      if (!ensureAudioGraph()) return null;
      const source = audioContext.createMediaElementSource(audio);
      source.connect(analyser);
      activeMediaElement = audio;
      if (timelineRef) timelineRef.current = { ...(timelineRef.current || {}), isPlaying: false, mediaTime: 0, duration: 0, provider: 'fish' };
      activeSources.add(source);
      modeRef.current = 'fish';
      // Resume asynchronously so this measurement path never deliberately waits before audio.play().
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
      startSampling();
      let disconnected = false;
      return () => {
        if (disconnected) return;
        disconnected = true;
        try { source.disconnect(); } catch { /* Already disconnected during cancellation. */ }
        activeSources.delete(source);
        if (activeMediaElement === audio) activeMediaElement = null;
      };
    } catch (error) {
      console.warn('[SpeechAudioController] Audio analysis unavailable; using approximate speech movement.', error);
      disconnectSources();
      modeRef.current = 'native';
      levelRef.current = 0;
      return null;
    }
  }

  function startNativeSpeech() {
    stopSampling();
    disconnectSources();
    activeMediaElement = null;
    modeRef.current = 'native';
    levelRef.current = 0;
    if (timelineRef) timelineRef.current = { ...(timelineRef.current || {}), isPlaying: true, mediaTime: 0, duration: 0, provider: 'native', wallClockStartedAt: performance.now() };
  }

  function dispose() {
    endSpeech();
    if (analyser) {
      try { analyser.disconnect(); } catch { /* Ignore graph teardown errors. */ }
      analyser = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
      const closingContext = audioContext;
      audioContext = null;
      closingContext.close().catch(() => {});
    } else {
      audioContext = null;
    }
    timeDomainData = null;
    frequencyData = null;
  }

  return {
    prepare,
    attachAudio,
    startNativeSpeech,
    endSpeech,
    stop: endSpeech,
    dispose,
  };
}
