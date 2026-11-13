# Contributing

Thanks for considering a contribution.

## Before opening a pull request
1. Check existing issues and discussions for duplicate work.
2. Describe the problem and expected behaviour.
3. Keep changes focused and include tests for behaviour changes.
4. Do not add API keys, personal data, chat exports, memory databases, or private logs.
5. Do not add models, textures, logos, music, or other assets unless you can document their redistribution rights.

## Development workflow

```powershell
npm ci
npm run dev
npm run test:all
npm run build
```

Use Node.js 24.15.0 or newer. For Windows desktop testing, also follow [the installation guide](docs/INSTALLATION.md).

## Pull request checklist
- [ ] Explain the user-visible change.
- [ ] Include or update automated tests.
- [ ] Run `npm run test:all`.
- [ ] Run `npm run build` when frontend or asset handling changes.
- [ ] Update documentation and release notes.
- [ ] Confirm no credentials or private user data are included.
- [ ] Confirm any added third-party content is properly licensed and attributed.

By submitting a contribution, you retain the rights you already hold in it. A project contribution policy or contributor agreement may be introduced before accepting contributions that require special licensing terms.
