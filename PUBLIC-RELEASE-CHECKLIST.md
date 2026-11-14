# Public release checklist — complete before pushing the repository

This source package has README and contributor documentation, but it is **not yet cleared for unrestricted public redistribution**.

- [x] Add the GNU GPL v3.0 licence text for the project code.
- [ ] Confirm that you own/control the rights to the original code and intend to distribute it under GPL v3.0.
- [ ] Verify redistribution permission for the four split Netherite armour GLBs.
- [ ] Verify redistribution permission for the Wemmbu logo/face image.
- [ ] Preserve the CC BY credits in `THIRD_PARTY_ASSETS.md`.
- [ ] Confirm creator-associated branding and promotional claims are presented as an unofficial fan project, with no implied endorsement.
- [ ] Keep the Fish Audio voice/reference ID blank by default unless authorised.
- [ ] Review npm/Rust dependency licences and required notices.
- [ ] Run a secret scan and check Git history before the first push.
- [ ] Run `npm ci`, `npm run test:all`, `npm run build`, and `npm run tauri:build:windows` on the supported toolchain.
- [ ] Install and test the generated Windows installer.
- [ ] Add real current screenshots and a short demo recording.
- [ ] Add a personal GitHub Sponsors/funding link only after the funding profile has been approved and the link is known.

A public repository without a licence is not equivalent to an open-source release. Do not tell users that the code is licensed for reuse until a licence file has been added.
