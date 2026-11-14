# Release notes — v0.2.9

## Public repository preparation
- Rewrote the top-level README with current project features, setup instructions, architecture links, privacy notes, and public-release caveats.
- Added installation, provider configuration, architecture, testing, third-party rights, roadmap, launch, and funding documentation.
- Added contribution and security policies plus a public-release checklist.
- Moved historical implementation reports and troubleshooting notes into `docs/development-history/`.
- Renamed the npm package to `wemmbu-ai-assistant` and synchronized npm, Tauri, and Cargo versions to 0.2.9.

## UI and configuration cleanup
- Removed the visible `PROTOTYPE` badge from the app title.
- Removed obsolete prototype-badge CSS.
- Updated the HTML title and page description.
- Removed the creator-associated Fish Audio voice reference ID from new-install defaults; users must configure a voice reference they are authorised to use.

## Verification
- `npm run test:all`: passed (98 tests).
- JavaScript syntax checks for the API server and public-release regression tests: passed.
- The Vite production build was attempted but could not run in this environment because the Vite executable is not installed.
- The Windows Tauri installer was not built here.

## Public-release blockers
- No root `LICENSE` file has been selected or added. The code should not be described as open-source until a licence is chosen and added.
- The four split armour GLBs have no verified redistribution licence in the supplied inventory.
- The Wemmbu logo/face image's source and redistribution permission are not documented.
- Add current screenshots and test a clean Windows installer before announcing a release.
