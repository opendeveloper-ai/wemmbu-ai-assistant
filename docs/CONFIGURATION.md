# Provider configuration

All provider credentials should be configured through the application's Settings UI. Do not hard-code private API keys in source files or commit a populated settings file.

## OpenRouter (chat)

1. Create an API key in the [OpenRouter key dashboard](https://openrouter.ai/keys).
2. Open Settings in the app.
3. Paste the key into the OpenRouter API key field.
4. Choose a model ID from the [OpenRouter model catalogue](https://openrouter.ai/models), or retain `openrouter/auto`.
5. Save the settings and use the connection test.
6. Review OpenRouter pricing and set an appropriate spend limit before regular use.

The local Node API stores the key in the app data directory. The frontend receives configuration status and a masked hint, not the raw saved key.

## Fish Audio (speech)

1. Create an API key through [Fish Audio Developers](https://fish.audio/developers/).
2. In Settings, choose Fish Audio as the speech provider.
3. Enter your API key.
4. Enter a voice/reference ID for a voice model whose use you are authorised to make.
5. Save settings and run the voice test.

This project intentionally leaves the voice/reference ID blank by default. A voice reference can identify or imitate a real person's voice; do not use or distribute a reference ID unless you have permission and it complies with Fish Audio's current terms and the voice model owner's rights.

Speech text is sent to Fish Audio when that provider is used. If Fish Audio is unavailable or not configured, the app can fall back to the browser/system voice.

## Google AI Studio (image generation)

1. Create a key from [Google AI Studio](https://aistudio.google.com/apikey).
2. In Settings, choose Google AI Studio as the image provider.
3. Paste the key and save settings.
4. Use image-generation features from chat.

Image generation may consume provider quota or incur charges. Review current provider pricing and policies.

## Local settings and data

The Node API stores settings, sessions, and memory in local app data. For development, the default project data directory is `data/`. The Tauri application uses the OS application-data directory.

Do not commit:
- `data/settings.json`
- session exports or chat transcripts
- SQLite memory databases and their WAL/SHM files
- memory backups or imported memory documents
- `.env` files or provider credentials

The repository `.gitignore` excludes these items. Check `git status --ignored` before creating a public commit.
