# Security Policy

Security reports are welcome. Please avoid publishing information that would let someone exploit a vulnerability or access another user's data.

## Reporting a vulnerability

**Do not open a public issue containing exploit steps, proof-of-concept code, API keys, tokens, private logs or personal data.**

If GitHub private vulnerability reporting is enabled for this repository, use **Security → Advisories → Report a vulnerability** to send the report privately.

If private vulnerability reporting is not available, open a minimal public issue titled `Security contact request`. Do not include technical details or a reproduction. Ask the maintainer to arrange a private channel, then share the report only through that channel.

A useful private report includes:

- The affected version or commit.
- The affected component and environment.
- A concise description of the security impact.
- Reproduction steps or a proof of concept, shared privately.
- Any mitigation you have identified.

Please allow time for the maintainer to investigate and prepare a fix before making the vulnerability public.

## What is in scope

Examples of security-relevant areas include:

- The local HTTP API in `server/index.js` and its loopback/CORS restrictions.
- Tauri process startup, resource resolution and the bundled Node.js runtime in `src-tauri/`.
- Storage and handling of provider credentials, chat sessions and local memory.
- Import, parsing and validation of user-supplied memory documents.
- Requests made from the local application to external AI, speech and image providers.

This application is designed as a single-user local desktop app. The local API is intended to listen on `127.0.0.1`; it is not intended to be exposed as a public multi-user service.

## Data handling notes

- Provider credentials and application data are stored locally by the Node service. In a Tauri installation, the data directory is the operating-system application-data directory; in development, it defaults to the repository's `data/` directory.
- Chat prompts sent to OpenRouter, speech text sent to Fish Audio, and image prompts sent to Google AI Studio are transmitted to those providers when the corresponding features are used.
- Local storage does not mean that provider-backed features are offline. Review the providers' terms and privacy policies before sending sensitive information.
- Do not commit populated settings files, API keys, access tokens, chat/session exports, SQLite memory files, memory backups or private diagnostics.

## If a credential is exposed

Treat an exposed credential as compromised. Revoke or rotate it with the provider immediately. Removing it in a later commit does not remove it from Git history. If it was pushed to a public repository, review the affected account and provider activity as well.

## Supported versions

Security fixes are currently targeted at the latest published version and the current `main` branch. Older versions may not receive backported fixes. Users should update to the latest available release or source revision when applying a security fix.
