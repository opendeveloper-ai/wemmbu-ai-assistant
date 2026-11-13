import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  AudioLines, Bot, Brain, Gamepad2, Hand, History, Home,
  MessageCircle, Mic, MicOff, Minus, PanelLeftClose, Plus, RotateCw, Square,
  Send, Settings, ShieldCheck, Sparkles, Trash2, Volume2, VolumeX, Copy, Download,
  Search, Palette, Sun, Moon, Monitor, X, Image as ImageIcon, LoaderCircle, Check,
} from 'lucide-react';
const CharacterStage = lazy(() => import('./CharacterStage.jsx'));
const SettingsPanel = lazy(() => import('./SettingsPanel.jsx'));
const MemoryPanel = lazy(() => import('./MemoryPanel.jsx'));
const preloadMemoryPanel = () => import('./MemoryPanel.jsx');
const preloadSettingsPanel = () => import('./SettingsPanel.jsx');
import MarkdownMessage from './MarkdownMessage.jsx';
import { createSpeechAudioController } from './speechAudioController.js';
import { SpeechPlaybackQueue } from './speechPlaybackQueue.js';
import { apiUrl } from './api.js';
import { CHARACTER_GESTURE_ACTIONS, detectNewGestureCommand } from '../shared/characterActions.js';

const GREETING_TEXT = "Hey! I'm Wemmbu. What are we doing today?";
const STORAGE_KEY = 'wemmbu_chat_sessions_v1';

function createSession() {
  const now = Date.now();
  return {
    id: `session_${now}_${Math.random().toString(36).slice(2, 7)}`,
    title: 'New Chat',
    createdAt: now,
    updatedAt: now,
    messages: [
      { id: 1, role: 'assistant', text: GREETING_TEXT }
    ]
  };
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const d = new Date(timestamp);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function loadLocalSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalSessions(sessions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // LocalStorage write failed (e.g. quota exceeded or private mode)
  }
}

function mergeSessions(localList, remoteList) {
  const map = new Map();
  for (const s of remoteList || []) {
    if (s && s.id) map.set(s.id, s);
  }
  for (const s of localList || []) {
    if (!s || !s.id) continue;
    const existing = map.get(s.id);
    if (!existing) {
      map.set(s.id, s);
    } else {
      const sTime = Number(s.updatedAt) || 0;
      const exTime = Number(existing.updatedAt) || 0;
      const sMsgs = Array.isArray(s.messages) ? s.messages.length : 0;
      const exMsgs = Array.isArray(existing.messages) ? existing.messages.length : 0;
      if (sTime > exTime || (sTime === exTime && sMsgs > exMsgs)) {
        map.set(s.id, s);
      }
    }
  }
  const merged = Array.from(map.values());
  merged.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  return merged;
}

async function persistSessionToBackend(session) {
  try {
    await fetch(apiUrl('/api/sessions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session)
    });
  } catch {
    // If local backend is unavailable, localStorage mirror preserves session
  }
}

async function deleteSessionFromBackend(id) {
  try {
    await fetch(apiUrl(`/api/sessions?id=${encodeURIComponent(id)}`), {
      method: 'DELETE'
    });
  } catch {
    // Ignore error
  }
}

function WemmbuLogo({ className = '', iconSize = 18 }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={`${className} wemmbu-logo-fallback`} aria-label="Wemmbu logo placeholder"><Bot size={iconSize} strokeWidth={2.2} /></span>;
  }
  return <img className={className} src="/assets/wemmbu_logo.png" alt="Wemmbu" onError={() => setFailed(true)} />;
}

function isImageGenerationRequest(text) {
  return /\b(?:generate|create|draw|render|make|design|illustrate)\b[\s\S]{0,120}\b(?:image|picture|illustration|artwork|wallpaper|poster|logo|thumbnail|portrait|scene|concept art)\b/i.test(text)
    || /\b(?:image|picture|illustration|artwork|wallpaper|poster|logo|thumbnail)\s+(?:of|showing|with)\b/i.test(text);
}

function extractImagePrompt(text) {
  const prompt = String(text || '').trim()
    .replace(/^(?:hey\s+wemmbu[, ]*)?(?:please\s+)?(?:can you\s+)?(?:generate|create|draw|render|make|design|illustrate)\s+(?:me\s+)?(?:an?\s+)?(?:image|picture|illustration|artwork|wallpaper|poster|logo|thumbnail|portrait|scene|concept art)\s*(?:(?:of|for|showing|with)\s+)?/i, '')
    .replace(/^(?:an?\s+)?(?:image|picture)\s+(?:of|showing)\s+/i, '')
    .trim();
  return prompt || text.trim();
}

function stripMarkdownForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' code block omitted ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?(\[([^\]]*)\])\([^)]*\)/g, '$2')
    .replace(/[*_~#>|]/g, '')
    .replace(/\|/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLocalCommandReply(text, actions) {
  const lower = text.toLowerCase().trim();
  if (/\b(?:stop rotation|stop spinning|stop rotating|pause rotation)\b/.test(lower)) {
    actions.setAutoRotate(false);
    actions.setAction('idle');
    actions.resetView?.();
    return 'Automatic rotation stopped. You can still drag to turn Wemmbu and change the camera angle.';
  }
  const directGesture = detectNewGestureCommand(text);
  if (directGesture) {
    actions.setAction(directGesture);
    const label = CHARACTER_GESTURE_ACTIONS.find((entry) => entry.action === directGesture)?.label || directGesture;
    return `${label} gesture triggered.`;
  }
  if (/\b(?:wave left|wave (?:with )?(?:your |the )?left hand|raise (?:your |the )?left hand)\b/i.test(text)) {
    actions.setAction('wave');
    return 'Waving with the left hand! 👋';
  }
  if (/^(?:please\s+)?(?:wave(?: at me)?|say hi|say hello|greet me|hello wemmbu|hi wemmbu)[!.\s]*$/i.test(text.trim()) || /\b(?:wave at me|wave hello|give me a wave|say hi to me)\b/i.test(text)) {
    actions.setAction('wave');
    return 'Waving with the left hand! 👋';
  }
  if (/^(?:please\s+)?(?:pose|strike a pose|show your pose|cool pose)[!.\s]*$/i.test(text.trim())) {
    actions.setAction('pose');
    return 'All right. Check out this pose.';
  }
  if (/\b(?:show|do|use) (?:the )?(?:explaining|explain) pose\b/i.test(text)) {
    actions.setAction('explain');
    return 'Here is the explaining gesture.';
  }
  if (/\b(?:reset pose|return to idle|stop gesture)\b/.test(lower)) {
    actions.setAction('idle');
    return 'Back to idle mode.';
  }
  const mentionsAll = /\b(?:full gear|all gear|everything|complete set)\b/.test(lower);
  const wantsArmor = /\b(?:netherite|armor|armour)\b/.test(lower);
  const wantsMace = /\b(?:mace|weapon)\b/.test(lower);
  const wantsTotem = /\b(?:totem|undying)\b/.test(lower);
  const equipIntent = /\b(?:equip|wear|put on)\b/.test(lower);
  const removeIntent = /\b(?:remove|unequip|take off|put away|stow)\b/.test(lower);
  const gearItemCount = Number(wantsArmor) + Number(wantsMace) + Number(wantsTotem);
  if (equipIntent && (mentionsAll || gearItemCount >= 2)) {
    // Only alter gear the user named. An explicit full-gear phrase means enable all three;
    // asking for mace + totem must not silently unequip existing armour.
    if (mentionsAll || wantsArmor) actions.setArmorOn(true);
    if (mentionsAll || wantsMace) actions.setMaceOn(true);
    if (mentionsAll || wantsTotem) actions.setTotemOn(true);
    const equipped = [
      ...(mentionsAll || wantsArmor ? ['Netherite armor'] : []),
      ...(mentionsAll || wantsMace ? ['mace in the main hand'] : []),
      ...(mentionsAll || wantsTotem ? ['Totem of Undying in the offhand'] : []),
    ];
    return `Equipped ${equipped.join(', ')}.`;
  }
  if (removeIntent && (mentionsAll || gearItemCount >= 2)) {
    if (mentionsAll || wantsArmor) actions.setArmorOn(false);
    if (mentionsAll || wantsMace) actions.setMaceOn(false);
    if (mentionsAll || wantsTotem) actions.setTotemOn(false);
    return 'Removed the requested gear.';
  }
  if (/(?:equip|wear|put on).*(?:netherite|armor|armour|full gear|all gear|complete set)/.test(lower) || mentionsAll && /\b(?:equip|wear|put on)\b/.test(lower)) {
    actions.setArmorOn(true);
    const equipMace = mentionsAll || wantsMace;
    const equipTotem = mentionsAll || wantsTotem;
    if (equipMace) actions.setMaceOn(true);
    if (equipTotem) actions.setTotemOn(true);
    if (equipMace && equipTotem) return 'Full Netherite armor equipped, mace in the main hand, and Totem of Undying in the offhand.';
    if (equipMace) return 'Netherite armor and main-hand mace equipped.';
    if (equipTotem) return 'Netherite armor and offhand Totem of Undying equipped.';
    return 'Netherite armor equipped.';
  }
  if (/(?:remove|unequip|take off).*(?:armor|armour|netherite)/.test(lower)) {
    actions.setArmorOn(false);
    return 'Netherite armor removed.';
  }
  if (/\b(?:equip|wear|hold|take|use)\b.*\bmace\b/.test(lower) || /^mace$/i.test(lower)) {
    if (/(?:unequip|remove|put away|stow|take off)/.test(lower)) {
      actions.setMaceOn(false);
      return 'Mace put away.';
    }
    actions.setMaceOn(true);
    return 'Mace equipped in the main hand.';
  }
  if (/\b(?:equip|wear|hold|take|use)\b.*\b(?:totem|undying)\b/.test(lower) || /^totem$/i.test(lower)) {
    if (/(?:unequip|remove|put away|stow|take off)/.test(lower)) {
      actions.setTotemOn(false);
      return 'Totem put away.';
    }
    actions.setTotemOn(true);
    return 'Totem of Undying equipped in the offhand.';
  }
  if (/(what can you do|help|commands|features)/.test(lower)) {
    return 'You can ask me to wave, pose, explain with gestures, equip or remove Netherite armor, equip a mace or Totem of Undying, rotate, stop rotation, search the web, or generate images. Configure OpenRouter and Google AI Studio in Settings for AI chat and image generation.';
  }
  if (/^(?:please\s+)?(?:start|enable|resume) (?:auto(?:matic)? )?(?:rotation|spinning)|\b(?:rotate around|keep rotating|start rotating|spin around)\b/.test(lower)) {
    actions.setAutoRotate(true);
    return 'Automatic rotation is on. Drag horizontally to turn Wemmbu or vertically to change the camera angle.';
  }
  return null;
}

export default function App() {
  const [sessions, setSessions] = useState(() => {
    const local = loadLocalSessions();
    if (local.length > 0) return local;
    const initial = createSession();
    saveLocalSessions([initial]);
    return [initial];
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const local = loadLocalSessions();
    return local.length > 0 ? local[0].id : null;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState('');
  const [activeNav, setActiveNav] = useState('Home');
  const [action, setAction] = useState('idle');
  const [actionDurationMs, setActionDurationMs] = useState(0);
  const [holdActionDuringSpeech, setHoldActionDuringSpeech] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [armorOn, setArmorOn] = useState(false);
  const [maceOn, setMaceOn] = useState(false);
  const [totemOn, setTotemOn] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [listening, setListening] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [apiConfigured, setApiConfigured] = useState(false);
  const [googleImageConfigured, setGoogleImageConfigured] = useState(false);
  const [imageProvider, setImageProvider] = useState('google');
  const [fishVoiceReady, setFishVoiceReady] = useState(false);
  const [ttsProvider, setTtsProvider] = useState('fish');
  // Mirrors actual audio playback so the 3D character speaks only while audio is playing.
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [viewResetKey, setViewResetKey] = useState(0);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('wemmbu_theme_v1') || 'auto'; } catch { return 'auto'; } });
  const [notice, setNotice] = useState('Local character commands ready');
  const [chatWidth, setChatWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('wemmbu_chat_panel_width_v1'));
      if (Number.isFinite(saved) && saved >= 360) return saved;
    } catch { /* Local storage may be unavailable in private mode. */ }
    return typeof window === 'undefined' ? 620 : Math.min(820, Math.max(420, Math.round(window.innerWidth * 0.43)));
  });

  const workspaceRef = useRef(null);
  const resizingChatRef = useRef(false);
  const chatWidthRef = useRef(chatWidth);
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  const gestureTimeoutRef = useRef(null);
  const speechRequestIdRef = useRef(0);
  const speechQueueRef = useRef(null);
  const pendingSpeechGestureRef = useRef(null);
  const speechPlaybackActiveRef = useRef(false);
  const fishAudioRef = useRef(null);
  const fishAudioUrlRef = useRef('');
  const fishAudioAbortRef = useRef(null);
  const speechMouthLevelRef = useRef(0);
  const speechMouthModeRef = useRef('idle');
  const speechTimelineRef = useRef({ sessionActive: false, isPlaying: false, mediaTime: 0, duration: 0, provider: 'idle' });
  const speechAudioControllerRef = useRef(null);

  const getSpeechAudioController = useCallback(() => {
    if (!speechAudioControllerRef.current) {
      speechAudioControllerRef.current = createSpeechAudioController(speechMouthLevelRef, speechMouthModeRef, speechTimelineRef);
    }
    return speechAudioControllerRef.current;
  }, []);

  const handleImageConfigChange = useCallback((config) => {
    setGoogleImageConfigured(Boolean(config.googleImageApiKeyConfigured));
    setImageProvider(config.imageProvider || 'google');
  }, []);

  const handleVoiceConfigChange = useCallback((config) => {
    setFishVoiceReady(Boolean(config.fishVoiceReady));
    setTtsProvider(config.ttsProvider || 'fish');
  }, []);

  const cancelSpeechPlayback = useCallback(() => {
    speechRequestIdRef.current += 1;
    speechQueueRef.current?.cancel?.();
    speechQueueRef.current = null;
    speechPlaybackActiveRef.current = false;
    speechTimelineRef.current = { ...speechTimelineRef.current, sessionActive: false, isPlaying: false, mediaTime: 0, duration: 0, provider: 'idle' };
    const hadSpeechGesture = Boolean(pendingSpeechGestureRef.current);
    pendingSpeechGestureRef.current = null;
    setHoldActionDuringSpeech(false);
    if (hadSpeechGesture) setAction('idle');
    setIsSpeaking(false);
    speechAudioControllerRef.current?.stop();
    fishAudioAbortRef.current?.abort?.();
    fishAudioAbortRef.current = null;
    const audio = fishAudioRef.current;
    if (audio) {
      audio.__wemmbuCancelSpeech?.();
      audio.onended = null;
      audio.onerror = null;
      audio.onplay = null;
      audio.pause();
      try { audio.currentTime = 0; } catch { /* Some loading states disallow seeking. */ }
      fishAudioRef.current = null;
    }
    if (fishAudioUrlRef.current) {
      URL.revokeObjectURL(fishAudioUrlRef.current);
      fishAudioUrlRef.current = '';
    }
    window.speechSynthesis?.cancel?.();
  }, []);


  useEffect(() => {
    chatWidthRef.current = chatWidth;
    try { localStorage.setItem('wemmbu_chat_panel_width_v1', String(Math.round(chatWidth))); } catch { /* Optional persistence only. */ }
  }, [chatWidth]);

  useEffect(() => {
    const getBounds = () => {
      const workspace = workspaceRef.current;
      if (!workspace) return { min: 360, max: 900, rightEdge: 0 };
      const rect = workspace.getBoundingClientRect();
      const styles = window.getComputedStyle(workspace);
      const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(styles.paddingRight) || 0;
      const contentWidth = Math.max(0, workspace.clientWidth - paddingLeft - paddingRight);
      return {
        min: 360,
        max: Math.max(360, Math.min(980, contentWidth - 300 - 14)),
        rightEdge: rect.right - paddingRight,
      };
    };

    const onPointerMove = (event) => {
      if (!resizingChatRef.current || window.innerWidth <= 760) return;
      const { min, max, rightEdge } = getBounds();
      if (!rightEdge) return;
      const nextWidth = Math.max(min, Math.min(max, rightEdge - event.clientX - 7));
      chatWidthRef.current = nextWidth;
      setChatWidth(nextWidth);
    };
    const stopResize = () => {
      resizingChatRef.current = false;
      document.body.classList.remove('resizing-chat-panel');
    };
    const onWindowResize = () => {
      if (window.innerWidth <= 760 || resizingChatRef.current) return;
      const { min, max } = getBounds();
      const nextWidth = Math.max(min, Math.min(max, chatWidthRef.current));
      if (nextWidth !== chatWidthRef.current) {
        chatWidthRef.current = nextWidth;
        setChatWidth(nextWidth);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    window.addEventListener('resize', onWindowResize);
    onWindowResize();
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      window.removeEventListener('resize', onWindowResize);
      document.body.classList.remove('resizing-chat-panel');
    };
  }, []);

  const startChatResize = (event) => {
    if (window.innerWidth <= 760) return;
    event.preventDefault();
    resizingChatRef.current = true;
    document.body.classList.add('resizing-chat-panel');
  };

  const handleChatResizeKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const workspace = workspaceRef.current;
    const styles = workspace ? window.getComputedStyle(workspace) : null;
    const paddingLeft = Number.parseFloat(styles?.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(styles?.paddingRight) || 0;
    const contentWidth = workspace ? workspace.clientWidth - paddingLeft - paddingRight : 1200;
    const min = 360;
    const max = Math.max(min, Math.min(980, contentWidth - 300 - 14));
    setChatWidth((current) => {
      const next = event.key === 'ArrowLeft' ? current + 24
        : event.key === 'ArrowRight' ? current - 24
          : event.key === 'Home' ? 480 : max;
      const bounded = Math.max(min, Math.min(max, next));
      chatWidthRef.current = bounded;
      return bounded;
    });
  };

  // Active session and messages
  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;
  const messages = activeSession?.messages || [];

  // Sync initial sessions from backend on mount: merge local and backend stores safely without losing newer messages
  useEffect(() => {
    let active = true;
    fetch(apiUrl('/api/sessions'))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const remote = Array.isArray(data?.sessions) ? data.sessions : [];
        const local = loadLocalSessions();
        const merged = mergeSessions(local, remote);
        if (merged.length > 0) {
          setSessions(merged);
          saveLocalSessions(merged);
          // Persist any local-only or newer sessions to backend
          for (const s of merged) {
            const r = remote.find((x) => x.id === s.id);
            if (!r || (Number(s.updatedAt) || 0) > (Number(r.updatedAt) || 0)) {
              persistSessionToBackend(s);
            }
          }
          setActiveSessionId((prev) => {
            if (prev && merged.some((s) => s.id === prev)) return prev;
            return merged[0].id;
          });
        } else {
          const fresh = createSession();
          setSessions([fresh]);
          setActiveSessionId(fresh.id);
          saveLocalSessions([fresh]);
          persistSessionToBackend(fresh);
        }
      })
      .catch(() => {
        // Local API offline: keep local sessions
      });
    return () => { active = false; };
  }, []);

  // Sync settings
  useEffect(() => {
    let active = true;
    fetch(apiUrl('/api/settings'))
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setApiConfigured(Boolean(data.apiKeyConfigured));
        setGoogleImageConfigured(Boolean(data.googleImageApiKeyConfigured));
        setImageProvider(data.imageProvider || 'google');
        setFishVoiceReady(Boolean(data.fishVoiceReady));
        setTtsProvider(data.ttsProvider || 'fish');
        setNotice(data.apiKeyConfigured ? `OpenRouter configured · ${data.model}` : 'Local character commands ready · configure OpenRouter for AI chat');
      })
      .catch(() => {
        if (active) setNotice('Local commands ready · start the local API to enable OpenRouter');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem('wemmbu_theme_v1', theme); } catch { /* storage may be unavailable */ }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = theme === 'auto' ? (media?.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    applyTheme();
    media?.addEventListener?.('change', applyTheme);
    return () => media?.removeEventListener?.('change', applyTheme);
  }, [theme]);

  useEffect(() => {
    const onKeyDown = (event) => { if (event.key === 'Escape') setLightboxImage(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, chatBusy]);

  useEffect(() => () => {
    recognitionRef.current?.stop?.();
    cancelSpeechPlayback();
    speechAudioControllerRef.current?.dispose();
    if (gestureTimeoutRef.current) window.clearTimeout(gestureTimeoutRef.current);
  }, [cancelSpeechPlayback]);

  const createSpeechSession = useCallback(() => {
    cancelSpeechPlayback();
    if (!voiceEnabled) return null;
    const requestId = speechRequestIdRef.current;
    const speechAudioController = getSpeechAudioController();
    const fishEnabled = ttsProvider === 'fish' && fishVoiceReady;
    speechTimelineRef.current = { sessionActive: true, isPlaying: false, mediaTime: 0, duration: 0, provider: fishEnabled ? 'fish' : 'native', startedAt: performance.now() };
    if (fishEnabled) speechAudioController.prepare();
    else if (ttsProvider === 'fish' && !fishVoiceReady) {
      setNotice('Fish Audio is not configured; using the Windows system voice.');
    }

    const speakNativeSegment = (text, onStart) => new Promise((resolve, reject) => {
      if (!text || !('speechSynthesis' in window)) { resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.02;
      utterance.pitch = 1.03;
      utterance.volume = 0.9;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((voice) => /en-IN|en-US|en-GB/i.test(voice.lang));
      if (preferred) utterance.voice = preferred;
      utterance.onstart = () => {
        speechAudioController.startNativeSpeech();
        onStart?.();
      };
      utterance.onend = resolve;
      utterance.onerror = (event) => {
        if (event?.error === 'canceled' || event?.error === 'interrupted') resolve();
        else reject(new Error(`System speech failed${event?.error ? ` (${event.error})` : ''}.`));
      };
      window.speechSynthesis.speak(utterance);
    });

    const queue = new SpeechPlaybackQueue({
      targetWords: 18,
      maxWords: 30,
      minChunkWords: 12,
      maxConcurrentGenerations: 2,
      maxBufferedSegments: 3,
      generateAudio: async (segmentText, signal) => {
        if (requestId !== speechRequestIdRef.current) throw new DOMException('Speech session cancelled.', 'AbortError');
        const cleanText = stripMarkdownForSpeech(segmentText);
        if (!cleanText) return null;
        if (!fishEnabled) return { kind: 'native', text: cleanText };
        const response = await fetch(apiUrl('/api/tts'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: cleanText }),
          signal
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Fish Audio request failed (${response.status}).`);
        }
        return { kind: 'fish', blob: await response.blob() };
      },
      playAudio: async (payload, segmentText, onStart) => {
        if (requestId !== speechRequestIdRef.current) throw new DOMException('Speech session cancelled.', 'AbortError');
        if (payload?.kind === 'native') {
          await speakNativeSegment(payload.text || stripMarkdownForSpeech(segmentText), onStart);
          return;
        }
        if (!payload?.blob) return;
        const objectUrl = URL.createObjectURL(payload.blob);
        const audio = new Audio(objectUrl);
        fishAudioUrlRef.current = objectUrl;
        fishAudioRef.current = audio;
        const detachAudioAnalysis = speechAudioController.attachAudio(audio);
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            audio.onplay = null;
            audio.onended = null;
            audio.onerror = null;
            audio.onpause = null;
            delete audio.__wemmbuCancelSpeech;
            detachAudioAnalysis?.();
            if (fishAudioRef.current === audio) fishAudioRef.current = null;
            if (fishAudioUrlRef.current === objectUrl) fishAudioUrlRef.current = '';
            URL.revokeObjectURL(objectUrl);
            callback(value);
          };
          audio.__wemmbuCancelSpeech = () => finish(reject, new DOMException('Speech playback cancelled.', 'AbortError'));
          audio.onplay = () => onStart?.();
          audio.onended = () => finish(resolve);
          audio.onerror = () => finish(reject, new Error('The generated Fish Audio segment could not be played.'));
          audio.play().catch((error) => finish(reject, error));
        });
      },
      playFallback: async (segmentText, onStart) => {
        setNotice('Fish Audio could not generate one segment; using system voice for that segment.');
        await speakNativeSegment(stripMarkdownForSpeech(segmentText), onStart);
      },
      onPlaybackStart: () => {
        if (requestId !== speechRequestIdRef.current) return;
        speechPlaybackActiveRef.current = true;
        setIsSpeaking(true);
        const pendingGesture = pendingSpeechGestureRef.current;
        if (pendingGesture?.holdDuringSpeech) {
          setActionDurationMs(pendingGesture.durationMs || 0);
          setHoldActionDuringSpeech(true);
          setAction(pendingGesture.action);
        }
      },
      onPlaybackFinish: () => {
        if (requestId !== speechRequestIdRef.current) return;
        speechPlaybackActiveRef.current = false;
        speechAudioController.endSpeech();
        setIsSpeaking(false);
        if (pendingSpeechGestureRef.current?.holdDuringSpeech) setAction('idle');
        pendingSpeechGestureRef.current = null;
        setHoldActionDuringSpeech(false);
        if (speechQueueRef.current === queue) speechQueueRef.current = null;
      },
      onError: (error, context) => {
        if (requestId !== speechRequestIdRef.current || error?.name === 'AbortError') return;
        console.warn('[Wemmbu speech] segment failure', { phase: context?.phase, message: error?.message });
      }
    });
    speechQueueRef.current = queue;
    return queue;
  }, [cancelSpeechPlayback, voiceEnabled, ttsProvider, fishVoiceReady, getSpeechAudioController]);

  const speak = useCallback((text, animateGesture = false) => {
    const spokenText = stripMarkdownForSpeech(text);
    if (!spokenText || !voiceEnabled) {
      cancelSpeechPlayback();
      if (animateGesture) setAction('idle');
      return Promise.resolve();
    }
    const queue = createSpeechSession();
    if (!queue) return Promise.resolve();
    if (animateGesture) {
      pendingSpeechGestureRef.current = { action: 'explain', durationMs: 0, holdDuringSpeech: true };
      setHoldActionDuringSpeech(true);
      if (speechPlaybackActiveRef.current) setAction('explain');
    }
    queue.pushText(spokenText);
    return queue.finish();
  }, [voiceEnabled, createSpeechSession, cancelSpeechPlayback]);


  // Update session helper
  const updateActiveSession = useCallback((updater) => {
    setSessions((prevSessions) => {
      const idx = prevSessions.findIndex((s) => s.id === activeSessionId);
      if (idx < 0) return prevSessions;
      const current = prevSessions[idx];
      const updated = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      const nextSessions = [...prevSessions];
      nextSessions[idx] = updated;
      // Sort by updatedAt descending
      nextSessions.sort((a, b) => b.updatedAt - a.updatedAt);
      saveLocalSessions(nextSessions);
      persistSessionToBackend(updated);
      return nextSessions;
    });
  }, [activeSessionId]);

  const updateSessionById = useCallback((sessionId, updater, persist = true) => {
    setSessions((previous) => {
      const index = previous.findIndex((session) => session.id === sessionId);
      if (index < 0) return previous;
      const current = previous[index];
      const nextSession = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      const nextSessions = [...previous];
      nextSessions[index] = nextSession;
      nextSessions.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
      saveLocalSessions(nextSessions);
      if (persist) persistSessionToBackend(nextSession);
      return nextSessions;
    });
  }, []);

  // Home navigation: start a fresh new chat session
  const handleHomeNav = useCallback(() => {
    // If the active session is already fresh with no user messages, keep it to avoid duplicates
    const hasUserMessages = activeSession?.messages?.some((m) => m.role === 'user');
    if (!hasUserMessages && activeSession) {
      setActiveNav('Home');
      return;
    }
    const newSession = createSession();
    setSessions((prev) => {
      const next = [newSession, ...prev];
      saveLocalSessions(next);
      persistSessionToBackend(newSession);
      return next;
    });
    setActiveSessionId(newSession.id);
    setActiveNav('Home');
  }, [activeSession]);

  // Chat navigation: resume latest active session
  const handleChatNav = useCallback(() => {
    setActiveNav('Chat');
    if (sessions.length === 0) {
      const newSession = createSession();
      setSessions([newSession]);
      setActiveSessionId(newSession.id);
      saveLocalSessions([newSession]);
      persistSessionToBackend(newSession);
    } else if (!activeSessionId || !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
    inputRef.current?.focus();
  }, [sessions, activeSessionId]);

  // Start new chat from sidebar or header
  const handleStartNewChat = useCallback(() => {
    const newSession = createSession();
    setSessions((prev) => {
      const next = [newSession, ...prev];
      saveLocalSessions(next);
      persistSessionToBackend(newSession);
      return next;
    });
    setActiveSessionId(newSession.id);
    setActiveNav('Chat');
    inputRef.current?.focus();
  }, []);

  // Delete chat session
  const handleDeleteSession = useCallback((sessionIdToDelete) => {
    deleteSessionFromBackend(sessionIdToDelete);
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== sessionIdToDelete);
      if (next.length === 0) {
        const fresh = createSession();
        saveLocalSessions([fresh]);
        persistSessionToBackend(fresh);
        setActiveSessionId(fresh.id);
        return [fresh];
      }
      saveLocalSessions(next);
      setActiveSessionId((curr) => (curr === sessionIdToDelete ? next[0].id : curr));
      return next;
    });
  }, []);

  const handleSend = useCallback(async (rawText = input) => {
    const text = rawText.trim();
    if (!text || chatBusy || !activeSession) return;
    // Start/resume the single analyser context during the user's Send gesture so the
    // eventual Fish Audio blob can be analysed without delaying its playback.
    if (voiceEnabled && ttsProvider === 'fish' && fishVoiceReady) {
      getSpeechAudioController().prepare();
    }
    setInput('');
    setActiveNav('Chat');

    const sessionId = activeSession.id;
    const userMsgId = Date.now();
    const userMessage = { id: userMsgId, role: 'user', text };
    const isFirstUserMessage = !activeSession.messages.some((message) => message.role === 'user');
    const updatedTitle = isFirstUserMessage ? (text.length > 34 ? `${text.slice(0, 34)}…` : text) : activeSession.title;
    const sessionWithUser = {
      ...activeSession,
      title: updatedTitle,
      updatedAt: Date.now(),
      messages: [...activeSession.messages, userMessage]
    };
    updateSessionById(sessionId, sessionWithUser, true);

    // A response starts from a predictable stage orientation. Do not keep spinning while
    // the character is speaking, generating, or executing a requested local action.
    setAutoRotate(false);
    setViewResetKey((current) => current + 1);
    setAction('idle');
    const actions = { setAction, setArmorOn, setMaceOn, setTotemOn, setAutoRotate, resetView: () => setViewResetKey((current) => current + 1) };
    const localReply = getLocalCommandReply(text, actions);
    if (localReply) {
      setTimeout(() => {
        const assistantMsg = { id: Date.now() + 1, role: 'assistant', text: localReply, status: 'complete' };
        updateSessionById(sessionId, (current) => ({ ...current, updatedAt: Date.now(), messages: [...current.messages, assistantMsg] }), true);
        setNotice('Character command completed locally');
        speak(localReply);
      }, 140);
      return;
    }

    const imageRequest = isImageGenerationRequest(text);
    if (imageRequest) {
      const assistantMsgId = Date.now() + 2;
      const prompt = extractImagePrompt(text);
      const useGoogle = imageProvider === 'google' && googleImageConfigured && !/\b(?:via|using|with)\s+openrouter\b/i.test(text);
      const provider = useGoogle ? 'google' : 'openrouter';
      const placeholder = {
        id: assistantMsgId,
        role: 'assistant',
        text: '',
        status: 'generating-image',
        imagePrompt: prompt,
        imageProvider: provider === 'google' ? 'Google AI Studio' : 'OpenRouter'
      };
      updateSessionById(sessionId, (current) => ({ ...current, updatedAt: Date.now(), messages: [...current.messages, placeholder] }), true);
      setChatBusy(true);
      setAction('idle');
      setNotice(`Generating image with ${provider === 'google' ? 'Google AI Studio' : 'OpenRouter'}…`);
      try {
        if (provider === 'openrouter' && !apiConfigured) throw new Error('Configure a Google AI Studio image key or an OpenRouter API key in Settings.');
        const endpoint = provider === 'google' ? '/api/image/google' : '/api/image/openrouter';
        const response = await fetch(apiUrl(endpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Image request failed (${response.status}).`);
        const assistantText = data.caption?.trim() || 'Here is the image you asked for.';
        updateSessionById(sessionId, (current) => ({
          ...current,
          updatedAt: Date.now(),
          messages: current.messages.map((message) => message.id === assistantMsgId ? {
            ...message,
            text: assistantText,
            status: 'complete',
            imageUrl: data.imageUrl,
            imageMimeType: data.imageMimeType || 'image/png',
            imageProvider: data.provider || (provider === 'google' ? 'Google AI Studio' : 'OpenRouter'),
            imageModel: data.model || ''
          } : message)
        }), true);
        setNotice(`Image generated · ${data.provider || provider}`);
        setAction('idle');
        speak('Your image is ready.');
      } catch (error) {
        const reply = `Image generation failed: ${error.message || 'Unknown error'}. Check the image-generation settings, API key, model and available quota.`;
        updateSessionById(sessionId, (current) => ({ ...current, updatedAt: Date.now(), messages: current.messages.map((message) => message.id === assistantMsgId ? { ...message, text: reply, status: 'error' } : message) }), true);
        setNotice('Image generation failed');
        setAction('idle');
      } finally {
        setChatBusy(false);
      }
      return;
    }

    if (!apiConfigured) {
      const reply = 'I can run character commands offline, but open-ended AI chat is not connected yet. Open Settings, add your OpenRouter API key, choose a model, and save the settings.';
      const assistantMsg = { id: Date.now() + 1, role: 'assistant', text: reply, status: 'complete' };
      updateSessionById(sessionId, (current) => ({ ...current, updatedAt: Date.now(), messages: [...current.messages, assistantMsg] }), true);
      setNotice('OpenRouter key required for AI chat');
      speak(reply, false);
      return;
    }

    const assistantMsgId = Date.now() + 3;
    const placeholder = { id: assistantMsgId, role: 'assistant', text: '', status: 'streaming' };
    updateSessionById(sessionId, (current) => ({ ...current, updatedAt: Date.now(), messages: [...current.messages, placeholder] }), true);
    setChatBusy(true);
    setAction('idle');
    setActionDurationMs(0);
    setHoldActionDuringSpeech(false);
    pendingSpeechGestureRef.current = null;
    const speechQueue = voiceEnabled ? createSpeechSession() : null;
    setNotice(webSearchEnabled ? 'Wemmbu is thinking and searching the web…' : 'Wemmbu is thinking…');
    const conversation = [...sessionWithUser.messages]
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .slice(-24)
      .map(({ role, text: content }) => ({ role, content }));
    let streamedReply = '';
    let finalData = null;
    const appliedCommandKeys = new Set();
    const applyCommands = (commandsToApply) => {
      for (const command of commandsToApply || []) {
        const key = [command?.type, command?.action, command?.item, command?.equipped].join(':');
        if (appliedCommandKeys.has(key)) continue;
        appliedCommandKeys.add(key);
        if (command.type === 'set_equipment') {
          if (command.item === 'armor') setArmorOn(command.equipped);
          if (command.item === 'mace') setMaceOn(command.equipped);
          if (command.item === 'totem') setTotemOn(command.equipped);
        } else if (command.type === 'character_action') {
          const isGesture = CHARACTER_GESTURE_ACTIONS.some((entry) => entry.action === command.action) || command.action === 'pose';
          if (isGesture) {
            const durationMs = Number.isFinite(Number(command.durationMs))
              ? Math.min(30000, Math.max(500, Number(command.durationMs))) : 0;
            const holdDuringSpeech = (command.holdDuringSpeech === true || command.action === 'explain') && voiceEnabled;
            setActionDurationMs(durationMs);
            if (holdDuringSpeech) {
              pendingSpeechGestureRef.current = { action: command.action, durationMs, holdDuringSpeech: true };
              setHoldActionDuringSpeech(true);
              // A speech-linked pose begins on the first audible sample, not when the LLM
              // returns its plan. If audio is already playing, apply it immediately.
              if (speechPlaybackActiveRef.current) setAction(command.action);
              else setAction('idle');
            } else {
              pendingSpeechGestureRef.current = null;
              setHoldActionDuringSpeech(false);
              setAction(command.action);
            }
          } else if (command.action === 'idle') {
            pendingSpeechGestureRef.current = null;
            setHoldActionDuringSpeech(false);
            setAction('idle');
          } else if (command.action === 'stop_rotation') { setAutoRotate(false); setAction('idle'); }
          else if (command.action === 'resume_rotation') setAutoRotate(true);
          else if (command.action === 'reset_view') setViewResetKey((current) => current + 1);
        }
      }
    };
    try {
      const response = await fetch(apiUrl('/api/chat/stream'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation, webSearch: webSearchEnabled })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${response.status}).`);
      }
      if (!response.body?.getReader) {
        throw new Error('This browser does not support streamed responses. Update Chrome or Edge and try again.');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const processEvent = (block) => {
        const dataLine = block.split(/\r?\n/).find((line) => line.startsWith('data:'));
        if (!dataLine) return;
        let payload;
        try { payload = JSON.parse(dataLine.slice(5).trim()); } catch { return; }
        if (payload.type === 'commands' && Array.isArray(payload.commands)) {
          // Apply visual commands as soon as the server receives the first model tool call;
          // do not wait for the model's follow-up natural-language answer to finish.
          applyCommands(payload.commands);
        } else if (payload.type === 'token' && typeof payload.token === 'string') {
          streamedReply += payload.token;
          speechQueue?.pushText(payload.token);
          updateSessionById(sessionId, (current) => ({
            ...current,
            messages: current.messages.map((message) => message.id === assistantMsgId ? { ...message, text: streamedReply, status: 'streaming' } : message)
          }), false);
        } else if (payload.type === 'complete') {
          finalData = payload;
          if (typeof payload.reply === 'string' && payload.reply && !streamedReply) streamedReply = payload.reply;
        } else if (payload.type === 'error') {
          throw new Error(payload.error || 'Streamed response failed.');
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separator;
        while ((separator = buffer.indexOf('\n\n')) >= 0) {
          const eventBlock = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          processEvent(eventBlock);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) processEvent(buffer);
      let reply = streamedReply.trim();
      const commands = Array.isArray(finalData?.commands) ? finalData.commands : [];
      // Final payload remains authoritative for persistence/recovery, while the Set avoids
      // restarting an animation that was already triggered by the earlier SSE command event.
      applyCommands(commands);
      if (!reply) {
        if (commands.length) reply = 'I applied the requested character action, but the AI model did not return a written answer. Please try again or select a different OpenRouter model.';
        else if (Array.isArray(finalData?.images) && finalData.images.length) reply = 'Here is the image I generated for you.';
        else reply = 'I didn’t receive any text from the model. Try again or choose a different OpenRouter model.';
      }
      const generatedImage = Array.isArray(finalData?.images) ? finalData.images[0] : null;
      updateSessionById(sessionId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        messages: current.messages.map((message) => message.id === assistantMsgId ? {
          ...message,
          text: reply,
          status: 'complete',
          model: finalData?.model || '',
          ...(generatedImage?.imageUrl ? {
            imageUrl: generatedImage.imageUrl,
            imageMimeType: generatedImage.imageMimeType || 'image/png',
            imagePrompt: generatedImage.prompt || text,
            imageProvider: generatedImage.provider || 'OpenRouter',
            imageModel: finalData?.model || ''
          } : {})
        } : message)
      }), true);
      setNotice(webSearchEnabled ? `OpenRouter · web-assisted response` : `OpenRouter · ${finalData?.model || 'response received'}`);
      // Speech was queued as text tokens arrived. Finish flushes the final partial sentence
      // while the already-generated audio continues to play in order.
      speechQueue?.finish();
    } catch (error) {
      const reply = `OpenRouter request failed: ${error.message || 'Unknown error'}. Check Settings, your model ID, API key, and available credits.`;
      updateSessionById(sessionId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        messages: current.messages.map((message) => message.id === assistantMsgId ? { ...message, text: streamedReply ? `${streamedReply}\n\n${reply}` : reply, status: 'error' } : message)
      }), true);
      setNotice('AI request failed');
      setAction('idle');
      if (streamedReply) speechQueue?.finish();
      else {
        speechQueue?.cancel();
        speechAudioControllerRef.current?.endSpeech();
        speechTimelineRef.current = { ...speechTimelineRef.current, sessionActive: false, isPlaying: false, mediaTime: 0, duration: 0, provider: 'idle' };
        pendingSpeechGestureRef.current = null;
        setHoldActionDuringSpeech(false);
        setAction('idle');
      }
    } finally {
      setChatBusy(false);
    }
  }, [input, chatBusy, activeSession, apiConfigured, googleImageConfigured, imageProvider, webSearchEnabled, speak, updateSessionById, voiceEnabled, ttsProvider, fishVoiceReady, getSpeechAudioController, createSpeechSession]);

  const startListening = () => {
    if (listening) {
      recognitionRef.current?.stop?.();
      setListening(false);
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setNotice('Voice input works best in Chrome or Edge');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => { setListening(true); setNotice('Listening… speak now'); };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      setInput(transcript);
      setNotice('Voice captured');
      void handleSend(transcript);
    };
    recognition.onerror = () => { setNotice('Could not hear that. Try again.'); setListening(false); };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try { recognition.start(); } catch { setNotice('Microphone is already active'); }
  };

  const doAction = (nextAction, confirmation) => {
    pendingSpeechGestureRef.current = null;
    setHoldActionDuringSpeech(false);
    setActionDurationMs(0);
    setAction(nextAction);
    setNotice(confirmation);
  };



  return (
    <div className="app-shell">
      <header className="window-bar">
        <div className="brand-mark"><WemmbuLogo className="brand-mark-image" iconSize={19} /></div>
        <div className="window-title">Wemmbu AI Assistant</div>
        <div className="window-spacer" />
        <div className="online-status"><span className={`status-dot ${apiConfigured ? '' : 'status-dot-off'}`} /> {apiConfigured ? 'Key Saved' : 'Local Mode'}</div>
        <button className="icon-button window-settings" title="Settings" onMouseEnter={preloadSettingsPanel} onFocus={preloadSettingsPanel} onClick={() => setActiveNav('Settings')}><Settings size={18} /></button>
        <details className="theme-menu"><summary className="icon-button theme-menu-trigger" title={`Appearance: ${theme}`} aria-label="Change appearance">{theme === 'dark' ? <Moon size={18} /> : theme === 'light' ? <Sun size={18} /> : <Monitor size={18} />}</summary><div className="theme-menu-options"><span>Appearance</span><button type="button" onClick={() => setTheme('light')} className={theme === 'light' ? 'selected' : ''}><Sun size={15} /> Light {theme === 'light' && <Check size={14} />}</button><button type="button" onClick={() => setTheme('dark')} className={theme === 'dark' ? 'selected' : ''}><Moon size={15} /> Dark {theme === 'dark' && <Check size={14} />}</button><button type="button" onClick={() => setTheme('auto')} className={theme === 'auto' ? 'selected' : ''}><Monitor size={15} /> Auto {theme === 'auto' && <Check size={14} />}</button></div></details>
      </header>

      <div className="app-body">
        <nav className="sidebar" aria-label="Main navigation">
          <button className={`nav-item ${activeNav === 'Home' ? 'active' : ''}`} onClick={handleHomeNav} title="Start a fresh new chat"><Home size={21} /><span>Home</span></button>
          <button className={`nav-item ${activeNav === 'Chat' ? 'active' : ''}`} onClick={handleChatNav} title="Resume latest active chat"><MessageCircle size={21} /><span>Chat</span></button>
          <button className={`nav-item ${activeNav === 'Actions' ? 'active' : ''}`} onClick={() => setActiveNav('Actions')}><Gamepad2 size={21} /><span>Actions</span></button>
          <button className={`nav-item ${activeNav === 'Memory' ? 'active' : ''}`} onMouseEnter={preloadMemoryPanel} onFocus={preloadMemoryPanel} onClick={() => setActiveNav('Memory')} title="Browse and manage local memories"><Brain size={21} /><span>Memory</span></button>
          <button className={`nav-item ${activeNav === 'Settings' ? 'active' : ''}`} onMouseEnter={preloadSettingsPanel} onFocus={preloadSettingsPanel} onClick={() => setActiveNav('Settings')}><Settings size={21} /><span>Settings</span></button>
          <div className="sidebar-bottom"><WemmbuLogo className="avatar-small" iconSize={19} /><span>Wemmbu</span></div>
        </nav>

        {sidebarOpen && (
          <aside className="chat-sessions-sidebar" aria-label="Chat sessions">
            <div className="sessions-header">
              <div className="sessions-title">
                <History size={16} />
                <span>Chat History</span>
              </div>
              <div className="sessions-header-actions">
                <button className="new-chat-btn" title="Create new chat" onClick={handleStartNewChat}>
                  <Plus size={14} /> <span>New Chat</span>
                </button>
                <button className="icon-button close-sessions-btn" title="Close sidebar" onClick={() => setSidebarOpen(false)}>
                  <PanelLeftClose size={16} />
                </button>
              </div>
            </div>
            <div className="sessions-list">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setActiveNav('Chat');
                    inputRef.current?.focus();
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setActiveSessionId(session.id);
                      setActiveNav('Chat');
                    }
                  }}
                >
                  <div className="session-item-icon">
                    <MessageCircle size={14} />
                  </div>
                  <div className="session-item-body">
                    <div className="session-item-title" title={session.title}>
                      {session.title}
                    </div>
                    <div className="session-item-time">
                      {formatTime(session.updatedAt)}
                    </div>
                  </div>
                  {sessions.length > 1 && (
                    <button
                      className="session-delete-btn"
                      title="Delete chat session"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(session.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}

        <main className="workspace" ref={workspaceRef} style={{ '--chat-panel-width': `${chatWidth}px` }}>
          <section className="character-panel">
            <div className="stage-heading">
              <div><span className="eyebrow">YOUR COMPANION</span><h1>Meet Wemmbu</h1><p>Chat, gear up, and make things happen.</p></div>
              <button className="round-soft" title="Reset pose" onClick={() => doAction('idle', 'Pose reset')}><RotateCw size={18} /></button>
            </div>
            <div className="character-stage-wrap">
              <div className="stage-glow" />
              <Suspense fallback={<div className="stage-loading" role="status"><LoaderCircle className="memory-spinner" size={22} /><span>Loading 3D character…</span></div>}><CharacterStage action={action} actionDurationMs={actionDurationMs} holdActionDuringSpeech={holdActionDuringSpeech} speechTimelineRef={speechTimelineRef} isSpeaking={isSpeaking} speechLevelRef={speechMouthLevelRef} speechModeRef={speechMouthModeRef} armorOn={armorOn} maceOn={maceOn} totemOn={totemOn} autoRotate={autoRotate} resetViewKey={viewResetKey} onActionComplete={() => setAction('idle')} /></Suspense>
              <div className="quick-actions">
                <button onClick={() => setAutoRotate(true)} title="Start automatic orbit rotation"><RotateCw size={17} /><span>Rotate</span></button>
                <button onClick={() => doAction('wave', 'Wave animation triggered')} title="Wave hello"><Hand size={17} /><span>Wave</span></button>
                <button onClick={() => setAutoRotate(false)} title="Stop automatic orbit rotation" disabled={!autoRotate} className={!autoRotate ? 'control-disabled' : ''}><Square size={15} /><span>Stop</span></button>
              </div>
            </div>
            <div className="stage-footer">
              <div className="stage-controls">
                <button className="circle-control" onClick={() => doAction('pose', 'Pose changed')} aria-label="Strike a pose">‹</button>
                <button className="circle-control play-control" onClick={() => doAction('wave', 'Wave animation triggered')} aria-label="Wave"><Hand size={19} /></button>
                <button className="circle-control" onClick={() => doAction('idle', 'Returned to idle')} aria-label="Return to idle">›</button>
              </div>
            </div>
          </section>

          <div
            className="chat-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize chat panel width"
            aria-valuemin={360}
            aria-valuemax={980}
            aria-valuenow={Math.round(chatWidth)}
            tabIndex={0}
            onPointerDown={startChatResize}
            onKeyDown={handleChatResizeKeyDown}
            title="Drag to resize the chat panel; use the arrow keys for fine adjustment"
          ><span /></div>

          <section className={`chat-panel ${activeNav === 'Settings' ? 'settings-mode' : ''} ${activeNav === 'Memory' ? 'memory-mode' : ''}`}>
            {activeNav === 'Memory' ? (
              <Suspense fallback={<div className="memory-loading" role="status"><LoaderCircle className="memory-spinner" size={18} /> Loading memory…</div>}><MemoryPanel /></Suspense>
            ) : activeNav === 'Settings' ? (
              <Suspense fallback={<div className="memory-loading" role="status"><LoaderCircle className="memory-spinner" size={18} /> Loading settings…</div>}><SettingsPanel onBack={() => setActiveNav('Chat')} onConfiguredChange={setApiConfigured} onImageConfigChange={handleImageConfigChange} onVoiceConfigChange={handleVoiceConfigChange} /></Suspense>
            ) : (
              <>
                <div className="chat-header">
                  <WemmbuLogo className="assistant-avatar" iconSize={23} />
                  <div className="chat-title-group">
                    <h2>Wemmbu</h2>
                    <p>Your AI companion <span className="beta-pill">BETA</span></p>
                  </div>
                  <div className="chat-header-actions">
                    <button
                      className={`history-toggle-btn ${sidebarOpen ? 'active' : ''}`}
                      title={sidebarOpen ? 'Close chat history sidebar' : 'Open chat history sidebar'}
                      onClick={() => setSidebarOpen((v) => !v)}
                    >
                      <History size={16} />
                      <span>History</span>
                    </button>
                    <div className="sound-wave-pill"><AudioLines size={21} /></div>
                    <button className={`voice-toggle ${voiceEnabled ? 'enabled' : ''}`} onClick={() => { setVoiceEnabled((value) => !value); if (voiceEnabled) cancelSpeechPlayback(); }}><Mic size={16} /> <span>Voice {voiceEnabled ? 'On' : 'Off'}</span></button>
                    <button className="icon-button speaker-button" title={voiceEnabled ? 'Mute responses' : 'Enable voice responses'} onClick={() => { setVoiceEnabled((value) => !value); if (voiceEnabled) cancelSpeechPlayback(); }}>{voiceEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />}</button>
                  </div>
                </div>

                {activeNav === 'Actions' && <div className="action-banner"><div><strong>Quick actions</strong><span>Trigger a character gesture or equip an item.</span></div><div className="action-equipment-row"><button onClick={() => setArmorOn((value) => !value)}>{armorOn ? 'Remove armor' : 'Equip armor'}</button><button onClick={() => setMaceOn((value) => !value)}>{maceOn ? 'Put mace away' : 'Equip mace'}</button><button onClick={() => setTotemOn((value) => !value)}>{totemOn ? 'Put totem away' : 'Equip totem'}</button><button onClick={() => doAction('pose', 'General pose triggered')}>Pose</button><button onClick={() => doAction('idle', 'Returned to idle')}>Idle</button></div><div className="gesture-actions-heading">Gestures</div><div className="gesture-action-grid">{CHARACTER_GESTURE_ACTIONS.map(({ action: gesture, label }) => <button key={gesture} type="button" onClick={() => doAction(gesture, `${label} gesture triggered`)} aria-label={`Trigger ${label} gesture`}>{label}</button>)}</div></div>}

                <div className="messages-area">
                  {messages.length === 0 && <div className="empty-chat"><div className="empty-icon"><Sparkles size={25} /></div><h3>Start a conversation</h3><p>Ask a question, request an image, or give your companion a command.</p></div>}
                  {messages.map((message) => <div className={`message-row ${message.role === 'user' ? 'user-row' : 'assistant-row'}`} key={message.id}>
                    {message.role === 'assistant' ? <WemmbuLogo className="message-avatar" iconSize={17} /> : <div className="user-avatar"><span>Y</span></div>}
                    <div className={`message-bubble ${message.role === 'user' ? 'user-bubble' : 'assistant-bubble'} ${message.imageUrl || message.status === 'generating-image' ? 'has-image-content' : ''}`}>
                      {message.role === 'assistant' ? <MarkdownMessage text={message.text || ''} /> : <p>{message.text}</p>}
                      {message.status === 'streaming' && !message.text && <div className="streaming-status"><span className="thinking-dots"><i /><i /><i /></span> Wemmbu is composing a reply…</div>}
                      {message.status === 'streaming' && message.text && <span className="streaming-cursor" aria-label="Wemmbu is still responding">▍</span>}
                      {message.status === 'generating-image' && <div className="image-generation-card"><div className="image-generation-preview"><div className="image-generation-glow" /><ImageIcon size={30} /><span className="image-generation-spinner"><LoaderCircle size={18} /></span></div><div className="image-generation-copy"><strong>Creating your image</strong><span>{message.imageProvider || 'Image generator'} is working on the composition, lighting and details.</span><div className="image-progress-track"><i /></div><small>This can take a little while. You can keep reading while it renders.</small></div></div>}
                      {message.imageUrl && <div className="generated-image-block"><button type="button" className="generated-image-open" onClick={() => setLightboxImage({ url: message.imageUrl, prompt: message.imagePrompt || 'Generated image', provider: message.imageProvider || 'Image generator' })} title="Open image"><img src={message.imageUrl} alt={message.imagePrompt || 'AI generated image'} loading="lazy" /></button><div className="generated-image-actions"><span>{message.imageProvider || 'Generated image'}{message.imageModel ? ` · ${message.imageModel}` : ''}</span><a href={message.imageUrl} download={`wemmbu-image-${message.id}.png`}><Download size={14} /> Download</a><button type="button" onClick={() => setLightboxImage({ url: message.imageUrl, prompt: message.imagePrompt || 'Generated image', provider: message.imageProvider || 'Image generator' })}><ImageIcon size={14} /> View</button></div></div>}
                      {message.role === 'assistant' && <div className="message-tools"><span className="message-ai-dot" /> <span>Wemmbu</span><button className="message-tool-button" title="Copy response" onClick={() => { navigator.clipboard?.writeText(message.text || '').then(() => setNotice('Response copied')).catch(() => setNotice('Could not access clipboard')); }}><Copy size={14} /></button><button className="message-tool-button" title="Read response aloud" onClick={() => speak(stripMarkdownForSpeech(message.text))}><Volume2 size={14} /></button></div>}
                    </div>
                  </div>)}
                  {chatBusy && !messages.some((message) => message.status === 'streaming' || message.status === 'generating-image') && <div className="message-row assistant-row"><WemmbuLogo className="message-avatar" iconSize={17} /><div className="message-bubble assistant-bubble thinking-bubble"><span className="thinking-dots"><i /><i /><i /></span> Thinking…</div></div>}
                  <div ref={messagesEndRef} />
                </div>

                <div className="suggestions-row">
                  <button className={`web-search-toggle ${webSearchEnabled ? 'active' : ''}`} onClick={() => { setWebSearchEnabled((value) => !value); setNotice(!webSearchEnabled ? 'Web search enabled for the next AI response' : 'Web search disabled'); }} title="Let OpenRouter search the web for this chat request"><Search size={13} /> {webSearchEnabled ? 'Web Search On' : 'Use Web Search'}</button>
                  <button onClick={() => handleSend('Wave at me')}>👋 Wave at me</button>
                  <button onClick={() => handleSend('Equip a mace')}>⚒ Equip mace</button>
                  <button onClick={() => handleSend('Equip armor, a mace and a totem')}>Equip full gear</button>
                  <button onClick={() => handleSend('What can you do?')}>✦ What can you do?</button>
                </div>
                <form className="composer" onSubmit={(event) => { event.preventDefault(); void handleSend(); }}>
                  <button type="button" className={`mic-button ${listening ? 'recording' : ''}`} title={listening ? 'Stop listening' : 'Speak a message'} onClick={startListening}>{listening ? <MicOff size={20} /> : <Mic size={20} />}</button>
                  <input ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} placeholder={listening ? 'Listening…' : 'Message Wemmbu…'} aria-label="Message Wemmbu" disabled={chatBusy} />
                  <button type="submit" className="send-button" aria-label="Send message" disabled={!input.trim() || chatBusy}><Send size={18} /></button>
                </form>
                <div className="composer-foot"><ShieldCheck size={12} /> {apiConfigured ? 'OpenRouter-enabled assistant' : 'Offline character commands · configure OpenRouter for AI'} <span>Enter to send</span></div>
              </>
            )}
          </section>
        </main>
      </div>
      {lightboxImage && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Generated image viewer" onMouseDown={(event) => { if (event.target === event.currentTarget) setLightboxImage(null); }}><div className="image-lightbox-header"><div><strong>{lightboxImage.prompt}</strong><span>{lightboxImage.provider}</span></div><div className="image-lightbox-controls"><a href={lightboxImage.url} download="wemmbu-generated-image.png"><Download size={16} /> Download</a><button type="button" onClick={() => setLightboxImage(null)} aria-label="Close image viewer"><X size={19} /></button></div></div><div className="image-lightbox-body"><img src={lightboxImage.url} alt={lightboxImage.prompt} /></div></div>}
    </div>
  );
}
