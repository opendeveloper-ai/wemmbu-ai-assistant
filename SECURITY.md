# Security policy

## Reporting a vulnerability

Please do not publish exploit details, API keys, private logs, or user data in a public issue.

Until a private security contact is configured for this repository, open a minimal GitHub issue asking for a private reporting channel without including the vulnerability details. A dedicated security email or GitHub private vulnerability reporting should be configured before public launch.

## Sensitive data

- Never commit `.env` files, API keys, provider tokens, or populated settings files.
- Do not commit session exports, local memory databases, memory backups, or private diagnostic logs.
- Rotate any credential that is accidentally committed. Deleting it in a later commit does not remove it from Git history.
- Do not expose the local API on a public interface; it is designed for loopback use.

## Supported versions

Security fixes are currently intended for the latest published source release. Older versions may not receive backports.
