import { useEffect, useState } from 'react';
import { apiUrl } from './api.js';
import { ArrowLeft, CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, LoaderCircle, Save, ShieldCheck, Trash2, Wifi, Image as ImageIcon, Sparkles, AudioLines, Play } from 'lucide-react';

function settingsRequestError(error) {
  if (error instanceof TypeError && /fetch/i.test(error.message || '')) {
    return 'Could not reach Wemmbu’s local API at 127.0.0.1:8787. Confirm the desktop app is open and inspect %APPDATA%\\com.wemmbu.assistant\\logs\\desktop-startup.log.';
  }
  return error?.message || 'The settings request failed. Check the Wemmbu desktop API log.';
}

async function readSettingsJson(response) {
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  try { return JSON.parse(raw || '{}'); } catch {
    throw new Error(`Wemmbu local API returned a non-JSON response (HTTP ${response.status}, ${contentType || 'unknown content type'}). Check desktop-startup.log.`);
  }
}



function openSettingsExternalUrl(event, url) {
  event.preventDefault();
  let parsed;
  try { parsed = new URL(url); } catch { return; }
  if (parsed.protocol !== 'https:') return;

  const opener = typeof window !== 'undefined' ? window.__TAURI__?.opener : null;
  if (typeof opener?.openUrl === 'function') {
    opener.openUrl(parsed.href).catch((error) => {
      console.error('[Settings] Could not open external link with the Tauri opener:', error);
    });
    return;
  }

  // Browser development fallback; the packaged Tauri build uses its native opener.
  const popup = window.open(parsed.href, '_blank', 'noopener,noreferrer');
  if (!popup) window.location.assign(parsed.href);
}

const fallbackSettings = {
  apiKeyConfigured: false,
  apiKeyHint: '',
  model: 'openrouter/auto',
  temperature: 0.7,
  maxTokens: 600,
  googleImageApiKeyConfigured: false,
  googleImageApiKeyHint: '',
  googleImageModel: 'gemini-nano-banana-2.1',
  googleImageAspectRatio: '1:1',
  googleImageSize: '1K',
  imageProvider: 'google',
  fishAudioApiKeyConfigured: false,
  fishAudioApiKeyHint: '',
  fishReferenceId: '',
  fishAudioModel: 's2.1-pro-free',
  ttsProvider: 'fish',
  systemPrompt: "You are Wemmbu, a friendly Minecraft-inspired desktop companion. Be direct, helpful, playful without being childish, and concise by default. Use the provided character_action and set_equipment tools to control only this app's avatar when requested. Do not force a gesture after every response; choose explaining gestures only when useful. Never claim to have changed the real world or performed actions that the app did not execute. Do not claim to be the real person Wemmbu."
};

export default function SettingsPanel({ onBack, onConfiguredChange, onImageConfigChange, onVoiceConfigChange }) {
  const [settings, setSettings] = useState(fallbackSettings);
  const [apiKey, setApiKey] = useState('');
  const [googleImageApiKey, setGoogleImageApiKey] = useState('');
  const [fishAudioApiKey, setFishAudioApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGoogleImageApiKey, setShowGoogleImageApiKey] = useState(false);
  const [showFishAudioApiKey, setShowFishAudioApiKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [status, setStatus] = useState({ type: 'neutral', text: 'Loading local settings…' });

  useEffect(() => {
    let active = true;
    fetch(apiUrl('/api/settings'))
      .then(async (response) => {
        const data = await readSettingsJson(response);
        if (!response.ok) throw new Error(data.error || 'Could not load settings.');
        if (!active) return;
        setSettings({ ...fallbackSettings, ...data });
        onConfiguredChange?.(Boolean(data.apiKeyConfigured));
        onImageConfigChange?.({ googleImageApiKeyConfigured: Boolean(data.googleImageApiKeyConfigured), imageProvider: data.imageProvider || 'google' });
        onVoiceConfigChange?.({ fishAudioApiKeyConfigured: Boolean(data.fishAudioApiKeyConfigured), fishVoiceReady: Boolean(data.fishVoiceReady), ttsProvider: data.ttsProvider || 'fish' });
        setStatus({ type: 'neutral', text: data.apiKeyConfigured ? 'An API key is saved locally.' : 'Add an OpenRouter API key to enable AI chat.' });
      })
      .catch((error) => {
        if (!active) return;
        setStatus({ type: 'error', text: settingsRequestError(error) });
      });
    return () => { active = false; };
  }, [onConfiguredChange, onImageConfigChange, onVoiceConfigChange]);

  const updateField = (field, value) => setSettings((current) => ({ ...current, [field]: value }));

  async function saveSettings(event) {
    event?.preventDefault?.();
    setBusy(true);
    setStatus({ type: 'neutral', text: 'Saving settings locally…' });
    try {
      const payload = {
        model: settings.model,
        temperature: Number(settings.temperature),
        maxTokens: Number(settings.maxTokens),
        systemPrompt: settings.systemPrompt,
        googleImageModel: settings.googleImageModel,
        googleImageAspectRatio: settings.googleImageAspectRatio,
        googleImageSize: settings.googleImageSize,
        imageProvider: settings.imageProvider,
        fishReferenceId: settings.fishReferenceId,
        fishAudioModel: settings.fishAudioModel,
        ttsProvider: settings.ttsProvider
      };
      if (apiKey.trim()) payload.apiKey = apiKey.trim();
      if (googleImageApiKey.trim()) payload.googleImageApiKey = googleImageApiKey.trim();
      if (fishAudioApiKey.trim()) payload.fishAudioApiKey = fishAudioApiKey.trim();
      const response = await fetch(apiUrl('/api/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await readSettingsJson(response);
      if (!response.ok) throw new Error(data.error || 'Failed to save settings.');
      setSettings((current) => ({ ...current, ...data }));
      setApiKey('');
      setGoogleImageApiKey('');
      setFishAudioApiKey('');
      onConfiguredChange?.(Boolean(data.apiKeyConfigured));
      onImageConfigChange?.({ googleImageApiKeyConfigured: Boolean(data.googleImageApiKeyConfigured), imageProvider: data.imageProvider || 'google' });
      onVoiceConfigChange?.({ fishAudioApiKeyConfigured: Boolean(data.fishAudioApiKeyConfigured), fishVoiceReady: Boolean(data.fishVoiceReady), ttsProvider: data.ttsProvider || 'fish' });
      setStatus({ type: 'success', text: data.apiKeyConfigured ? 'Settings saved. API keys stay on this computer.' : 'Settings saved. Add an OpenRouter API key to enable AI chat.' });
      return true;
    } catch (error) {
      setStatus({ type: 'error', text: settingsRequestError(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setStatus({ type: 'neutral', text: 'Testing OpenRouter… this sends a short API request and may use a small amount of model credit.' });
    try {
      const response = await fetch(apiUrl('/api/test'), { method: 'POST' });
      const data = await readSettingsJson(response);
      if (!response.ok) throw new Error(data.error || 'OpenRouter test failed.');
      setStatus({ type: 'success', text: `Connected successfully using ${data.model}.` });
      onConfiguredChange?.(true);
    } catch (error) {
      setStatus({ type: 'error', text: settingsRequestError(error) });
    } finally {
      setTesting(false);
    }
  }

  async function clearApiKey() {
    if (!window.confirm('Remove the saved OpenRouter API key from this computer?')) return;
    setBusy(true);
    try {
      const response = await fetch(apiUrl('/api/settings'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearApiKey: true })
      });
      const data = await readSettingsJson(response);
      if (!response.ok) throw new Error(data.error || 'Could not remove API key.');
      setSettings((current) => ({ ...current, ...data }));
      setApiKey('');
      onConfiguredChange?.(false);
      setStatus({ type: 'success', text: 'Saved API key removed from this computer.' });
    } catch (error) {
      setStatus({ type: 'error', text: settingsRequestError(error) });
    } finally {
      setBusy(false);
    }
  }

  async function clearGoogleImageKey() {
    if (!window.confirm('Remove the saved Google AI Studio image-generation key from this computer?')) return;
    setBusy(true);
    try {
      const response = await fetch(apiUrl('/api/settings'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearGoogleImageApiKey: true })
      });
      const data = await readSettingsJson(response);
      if (!response.ok) throw new Error(data.error || 'Could not remove Google AI Studio key.');
      setSettings((current) => ({ ...current, ...data }));
      setGoogleImageApiKey('');
      onImageConfigChange?.({ googleImageApiKeyConfigured: Boolean(data.googleImageApiKeyConfigured), imageProvider: data.imageProvider || 'google' });
      setStatus({ type: 'success', text: 'Google AI Studio image key removed from this computer.' });
    } catch (error) {
      setStatus({ type: 'error', text: settingsRequestError(error) });
    } finally { setBusy(false); }
  }

  async function clearFishAudioKey() {
    if (!window.confirm('Remove the saved Fish Audio API key from this computer?')) return;
    setBusy(true);
    try {
      const response = await fetch(apiUrl('/api/settings'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearFishAudioApiKey: true })
      });
      const data = await readSettingsJson(response);
      if (!response.ok) throw new Error(data.error || 'Could not remove Fish Audio API key.');
      setSettings((current) => ({ ...current, ...data }));
      setFishAudioApiKey('');
      onVoiceConfigChange?.({ fishAudioApiKeyConfigured: Boolean(data.fishAudioApiKeyConfigured), fishVoiceReady: Boolean(data.fishVoiceReady), ttsProvider: data.ttsProvider || 'fish' });
      setStatus({ type: 'success', text: 'Fish Audio API key removed from this computer.' });
    } catch (error) {
      setStatus({ type: 'error', text: settingsRequestError(error) });
    } finally { setBusy(false); }
  }

  async function testFishVoice() {
    const saved = await saveSettings();
    if (!saved) return;
    setTestingVoice(true);
    setStatus({ type: 'neutral', text: 'Generating a short Fish Audio voice test. This sends a short text to Fish Audio.' });
    let objectUrl = '';
    try {
      const response = await fetch(apiUrl('/api/tts'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hey! This is a quick voice test for Wemmbu Assistant.' })
      });
      if (!response.ok) {
        const data = await readSettingsJson(response).catch(() => ({}));
        throw new Error(data.error || `Fish Audio voice test failed (${response.status}).`);
      }
      objectUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(objectUrl);
      await new Promise((resolve, reject) => {
        audio.onended = resolve;
        audio.onerror = () => reject(new Error('The returned audio could not be played by this browser.'));
        audio.play().catch(reject);
      });
      setStatus({ type: 'success', text: 'Fish Audio voice test played successfully.' });
    } catch (error) {
      setStatus({ type: 'error', text: settingsRequestError(error) });
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setTestingVoice(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <button className="settings-back-button" type="button" onClick={onBack}><ArrowLeft size={17} /> Back to chat</button>
        <span className="settings-eyebrow">PREFERENCES</span>
        <h2>Assistant settings</h2>
        <p>Configure chat, character-control tools, and image generation.</p>
      </header>

      <form className="settings-form" onSubmit={saveSettings}>
        <section className="settings-card">
          <div className="settings-section-heading">
            <div className="settings-heading-icon"><KeyRound size={18} /></div>
            <div><h3>OpenRouter connection</h3><p>Your key is saved by the local Node service, not in the browser bundle.</p></div>
          </div>
          <label className="settings-label" htmlFor="openrouter-key">API key</label>
          <div className="api-key-input-wrap">
            <input id="openrouter-key" className="settings-input key-input" type={showApiKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={settings.apiKeyConfigured ? `Saved key: ${settings.apiKeyHint} · leave blank to keep it` : 'Paste your OpenRouter API key'} autoComplete="new-password" spellCheck="false" />
            <button className="input-icon-button" type="button" title={showApiKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <div className="settings-inline-note"><ShieldCheck size={14} /><span>Never paste the key into source code or share it in screenshots.</span></div>
          <div className="settings-link-row"><a href="https://openrouter.ai/keys" onClick={(event) => openSettingsExternalUrl(event, "https://openrouter.ai/keys")}>Get an API key <ExternalLink size={12} /></a><span className={`saved-key-status ${settings.apiKeyConfigured ? 'is-connected' : ''}`}><span className="status-dot" />{settings.apiKeyConfigured ? 'Key saved locally' : 'No key saved'}</span></div>
        </section>

        <section className="settings-card">
          <div className="settings-section-heading">
            <div className="settings-heading-icon"><Wifi size={18} /></div>
            <div><h3>Model configuration</h3><p>Use a model ID from the OpenRouter model catalogue.</p></div>
          </div>
          <label className="settings-label" htmlFor="openrouter-model">Model ID</label>
          <input id="openrouter-model" className="settings-input" value={settings.model} onChange={(event) => updateField('model', event.target.value)} placeholder="openrouter/auto" required maxLength={180} />
          <div className="settings-model-help">Examples: <code>openrouter/auto</code> or a provider/model ID. <a href="https://openrouter.ai/models" onClick={(event) => openSettingsExternalUrl(event, "https://openrouter.ai/models")}>Browse models <ExternalLink size={11} /></a></div>
          <div className="settings-two-column">
            <div><label className="settings-label" htmlFor="temperature">Temperature <span>{Number(settings.temperature).toFixed(1)}</span></label><input id="temperature" className="settings-range" type="range" min="0" max="2" step="0.1" value={settings.temperature} onChange={(event) => updateField('temperature', Number(event.target.value))} /><p className="settings-field-help">Lower = more consistent; higher = more varied.</p></div>
            <div><label className="settings-label" htmlFor="max-tokens">Max output tokens</label><input id="max-tokens" className="settings-input" type="number" min="32" max="8192" step="32" value={settings.maxTokens} onChange={(event) => updateField('maxTokens', Number(event.target.value))} required /><p className="settings-field-help">Higher limits may cost more.</p></div>
          </div>
          <label className="settings-label" htmlFor="system-prompt">Assistant personality / system prompt</label>
          <textarea id="system-prompt" className="settings-textarea" value={settings.systemPrompt} onChange={(event) => updateField('systemPrompt', event.target.value)} rows={4} maxLength={5000} />
        </section>

        <section className="settings-card voice-settings-card">
          <div className="settings-section-heading">
            <div className="settings-heading-icon"><AudioLines size={18} /></div>
            <div><h3>Speech voice</h3><p>Use Fish Audio TTS instead of the browser's generic system voice.</p></div>
          </div>
          <label className="settings-label" htmlFor="tts-provider">Speech provider</label>
          <select id="tts-provider" className="settings-input" value={settings.ttsProvider} onChange={(event) => updateField('ttsProvider', event.target.value)}>
            <option value="fish">Fish Audio (selected voice)</option>
            <option value="native">System voice (local fallback)</option>
          </select>

          <label className="settings-label" htmlFor="fish-audio-key">Fish Audio API key</label>
          <div className="api-key-input-wrap">
            <input id="fish-audio-key" className="settings-input key-input" type={showFishAudioApiKey ? 'text' : 'password'} value={fishAudioApiKey} onChange={(event) => setFishAudioApiKey(event.target.value)} placeholder={settings.fishAudioApiKeyConfigured ? `Saved key: ${settings.fishAudioApiKeyHint} · leave blank to keep it` : 'Paste your Fish Audio API key'} autoComplete="new-password" spellCheck="false" />
            <button className="input-icon-button" type="button" title={showFishAudioApiKey ? 'Hide API key' : 'Show API key'} onClick={() => setShowFishAudioApiKey((value) => !value)}>{showFishAudioApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <div className="settings-link-row">
            <a href="https://fish.audio/developers/" onClick={(event) => openSettingsExternalUrl(event, "https://fish.audio/developers/")}>Fish Audio API documentation <ExternalLink size={12} /></a>
            <span className={`saved-key-status ${settings.fishAudioApiKeyConfigured ? 'is-connected' : ''}`}><span className="status-dot" />{settings.fishAudioApiKeyConfigured ? 'Key saved locally' : 'No key saved'}</span>
          </div>

          <label className="settings-label" htmlFor="fish-reference-id">Voice model / reference ID</label>
          <input id="fish-reference-id" className="settings-input" value={settings.fishReferenceId} onChange={(event) => updateField('fishReferenceId', event.target.value)} maxLength={120} placeholder="Fish Audio voice/reference ID" autoComplete="off" spellCheck="false" />
          <p className="settings-field-help">Use the voice ID shown by Fish Audio. Public availability alone does not confirm permission to imitate a real person's voice; use a model you are authorised to use.</p>

          <label className="settings-label" htmlFor="fish-audio-model">Fish Audio model</label>
          <select id="fish-audio-model" className="settings-input" value={settings.fishAudioModel} onChange={(event) => updateField('fishAudioModel', event.target.value)}>
            <option value="s2.1-pro-free">S2.1 Pro Free (fair-use / availability may change)</option>
            <option value="s2.1-pro">S2.1 Pro (paid)</option>
          </select>
          <p className="settings-cost-note">The free model is subject to provider fair-use rules and availability. API keys and saved settings remain on this computer; the speech text is sent to Fish Audio to generate audio.</p>
          <div className="settings-footer-actions">
            <button className="settings-secondary-button" type="button" onClick={testFishVoice} disabled={busy || testing || testingVoice || (!settings.fishAudioApiKeyConfigured && !fishAudioApiKey.trim()) || !settings.fishReferenceId}>{testingVoice ? <LoaderCircle size={16} className="spin-icon" /> : <Play size={16} />}{testingVoice ? 'Generating voice test…' : 'Test voice'}</button>
            {settings.fishAudioApiKeyConfigured && <button className="settings-danger-button" type="button" onClick={clearFishAudioKey} disabled={busy || testing || testingVoice}><Trash2 size={15} /> Remove Fish Audio key</button>}
          </div>
        </section>

        <section className="settings-card image-settings-card">
          <div className="settings-section-heading">
            <div className="settings-heading-icon"><ImageIcon size={18} /></div>
            <div><h3>Image generation</h3><p>Generate images only with Google AI Studio or OpenRouter. Keys remain in local backend settings.</p></div>
          </div>
          <label className="settings-label" htmlFor="image-provider">Image provider</label>
          <select id="image-provider" className="settings-input" value={settings.imageProvider} onChange={(event) => updateField('imageProvider', event.target.value)}>
            <option value="google">Google AI Studio (recommended)</option>
            <option value="openrouter">OpenRouter image-generation tool</option>
          </select>
          <div className="settings-inline-note"><Sparkles size={14} /><span>Normal chat continues to use OpenRouter. This key is used only for image generation.</span></div>

          <label className="settings-label" htmlFor="google-image-key">Google AI Studio API key</label>
          <div className="api-key-input-wrap">
            <input id="google-image-key" className="settings-input key-input" type={showGoogleImageApiKey ? 'text' : 'password'} value={googleImageApiKey} onChange={(event) => setGoogleImageApiKey(event.target.value)} placeholder={settings.googleImageApiKeyConfigured ? `Saved key: ${settings.googleImageApiKeyHint} · leave blank to keep it` : 'Paste Google AI Studio API key'} autoComplete="new-password" spellCheck="false" />
            <button className="input-icon-button" type="button" title={showGoogleImageApiKey ? 'Hide image API key' : 'Show image API key'} onClick={() => setShowGoogleImageApiKey((value) => !value)}>{showGoogleImageApiKey ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          <div className="settings-link-row">
            <a href="https://aistudio.google.com/apikey" onClick={(event) => openSettingsExternalUrl(event, "https://aistudio.google.com/apikey")}>Get a Google AI Studio key <ExternalLink size={12} /></a>
            <span className={`saved-key-status ${settings.googleImageApiKeyConfigured ? 'is-connected' : ''}`}><span className="status-dot" />{settings.googleImageApiKeyConfigured ? 'Image key saved locally' : 'No image key saved'}</span>
          </div>
          <div className="settings-two-column image-options-grid">
            <div>
              <label className="settings-label" htmlFor="google-image-model">Image model</label>
              <input id="google-image-model" className="settings-input" value={settings.googleImageModel} onChange={(event) => updateField('googleImageModel', event.target.value)} maxLength={140} placeholder="gemini-nano-banana-2.1" />
              <p className="settings-field-help">Example: <code>gemini-nano-banana-2.1</code>.</p>
            </div>
            <div>
              <label className="settings-label" htmlFor="google-image-ratio">Aspect ratio</label>
              <select id="google-image-ratio" className="settings-input" value={settings.googleImageAspectRatio} onChange={(event) => updateField('googleImageAspectRatio', event.target.value)}>
                {['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '5:4', '4:5', '21:9'].map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select>
            </div>
          </div>
          <label className="settings-label" htmlFor="google-image-size">Resolution</label>
          <select id="google-image-size" className="settings-input" value={settings.googleImageSize} onChange={(event) => updateField('googleImageSize', event.target.value)}>
            <option value="512">512 px (lower latency)</option>
            <option value="1K">1K</option>
            <option value="2K">2K</option>
            <option value="4K">4K (higher cost/latency)</option>
          </select>
          {settings.googleImageApiKeyConfigured && <button className="settings-danger-button" type="button" onClick={clearGoogleImageKey} disabled={busy || testing}><Trash2 size={15} /> Remove Google image key</button>}
          <p className="settings-cost-note">Image generation can consume API quota or credits. Google-generated images include SynthID provenance marking. See the provider's current pricing before high-resolution generation.</p>
        </section>

        <div className={`settings-status status-${status.type}`} role="status">{status.type === 'success' ? <CheckCircle2 size={16} /> : status.type === 'error' ? <ShieldCheck size={16} /> : <Wifi size={16} />}<span>{status.text}</span></div>
        <div className="settings-footer-actions">
          <button className="settings-primary-button" type="submit" disabled={busy || testing}>{busy ? <LoaderCircle size={16} className="spin-icon" /> : <Save size={16} />}{busy ? 'Saving…' : 'Save settings'}</button>
          <button className="settings-secondary-button" type="button" onClick={testConnection} disabled={busy || testing || !settings.apiKeyConfigured}>{testing ? <LoaderCircle size={16} className="spin-icon" /> : <Wifi size={16} />}{testing ? 'Testing…' : 'Test connection'}</button>
          {settings.apiKeyConfigured && <button className="settings-danger-button" type="button" onClick={clearApiKey} disabled={busy || testing}><Trash2 size={15} /> Remove key</button>}
        </div>
        <p className="settings-cost-note">OpenRouter requests may consume credits depending on your chosen model. Save a key before testing the connection.</p>
      </form>
    </div>
  );
}
