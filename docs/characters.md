# Character registry

The character registry is the source of truth for character ownership and reward routing. Automatic session XP and gold are recorded in the append-only progression ledger.

## Member workflow

- `/character create` registers a character as pending. A secure sheet URL and season label are optional.
- `/character list` shows full character IDs, approval status, main/frozen state, and imported opening balances.
- The first character an administrator approves becomes the member's main character automatically.
- `/character main` selects another approved, active character as main.
- `/character freeze` pauses progression on an approved secondary character. A frozen character may still be played, but its session rewards route to the main character.
- `/character unfreeze` resumes progression on a secondary character.
- `/character archive` closes a character without deleting its history and requires confirmation.

## Administrator workflow

- `/character-admin pending` lists pending registrations and their owners.
- `/character-admin approve` approves a record. Existing characters can be imported with non-negative opening XP and gold. A reason and confirmation are required.
- `/character-admin revoke` closes a pending or approved record while retaining the audit history. A reason and confirmation are required.

The bot enforces the existing administrator policy at runtime: Discord Administrator or Manage Server permission. Discord's command registration also defaults `/character-admin` to Manage Server.

## Reward-routing contract

- A player's reward defaults to the approved character that played.
- If that played character is frozen, the reward routes to the member's approved main character.
- A DM's reward defaults to their approved main character.
- A DM may select another approved, active character they own. Frozen characters are not valid DM reward targets.

Every create, approval, main change, freeze/unfreeze, revoke, and archive operation produces an append-only `character_events` record. Character IDs and foreign keys are guild-scoped, and the database permits at most one approved main character per member.
