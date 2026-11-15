# Releasing Castaway

Cloudflare builds and publishes whatever lands on `master`. Before and after each push that players will see:

1. **What's new**: an entry at the top of `UPDATES` in `src/castaway/ui/whatsnew.ts` for anything players notice.
   `progress.md` updated in the same commit.
2. **Checks**: `npm run typecheck` (or `npx tsc --noEmit`), `npm test`, `npx vite build`. The GitHub Actions
   workflow runs the same; it should be green on the commit.
3. **Browser check** (until the smoke tests of plan item 29 exist): `npx vite preview`, press Play on Low and on
   High, chop a tree, place a piece, save, reload, see it still there. Open the customise screen with each body.
4. **After the push**: the Cloudflare build is green, and the live menu shows the new version number
   (`v1.<commits> · date · commit`).
5. **Old and new together**: one tab on the old version (opened before the push), one on the new: host on one,
   join from the other. The one behind is told to reload; nothing breaks for the host.
6. **Phone**: open the live site on a phone, Play, move, open the bag and Settings.

## Rolling back

If a release is bad, revert the commit(s) on `master` (`git revert`, never a force push) and push: Cloudflare
rebuilds the reverted state. Players' saves are forward compatible only, so a rollback past a save layout change
(`LAYOUT` in `net/save.ts`) needs a migration check first.

Last known good: `85e5f18` (2026-11-15, all checks passed locally). Update this line after each release you have
checked live.
