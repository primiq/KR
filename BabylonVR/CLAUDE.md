# BabylonVR (Petr's Castaway)

- **What's new**: every player-facing addition or big change gets an entry at the TOP of `UPDATES` in
  `src/castaway/ui/whatsnew.ts` (date, short headline, a few plain-language lines), in the same commit as the change.
  Its date drives the "new" dot on the main menu's What's new button.
- **No long dashes, ever** (the em dash and the en dash): not in game text, menus, What's new, comments or commit
  messages. Use a normal hyphen "-", a comma, or a full stop instead.
- **progress.md**: the hand-off record (state, architecture, decisions, recent work, open issues). Update it with every
  batch of work, in the same commit, so the project can be handed on without the conversation history.
