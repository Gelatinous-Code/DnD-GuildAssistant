# Player character journals

Player journals are optional, player-authored reflections linked to a completed session, the player's approved character, and the official GM recap. They are visible only after submission and can be edited by their author for seven days after the first submission.

## Discord setup

Create the `Player Character Journals` forum post or thread in `second-dawn-guild`, then run:

```text
/journal-admin configure thread:<thread>
```

The configured thread is guild-scoped. Submissions made before configuration remain in D1 as `not_configured`; configuring the thread makes them eligible for scheduled delivery.

## Player workflow

1. Run `/journal write` and choose the approved character that played the session. An optional session ID can disambiguate older sessions.
2. Select **Write or edit journal** in the private response.
3. Enter a title and journal text in the modal.
4. Submit. The bot creates or updates one formatted Discord message for that player, character, and session.

`/journal list` privately shows recent drafts and submissions. Replayed interactions reuse the committed revision, and Discord's enforced nonce prevents duplicate messages. If Discord is unavailable, delivery retries with backoff; the journal remains safely stored in D1.

The author may edit until the exact `edit_expires_at` timestamp, seven days after first submission. Losing the configured Guild Player role removes command access. A corrected or cancelled completion revision also makes the journal unavailable to the author rather than leaving it attached to stale attendance.

## Moderation and recovery

Administrators use `/journal-admin status` to check configuration and `/journal-admin manage` to hide, unhide, or retry an entry. Hiding replaces the Discord content with a moderation notice and removes the journal from website reads. Administrators cannot rewrite the author's title or text. Every author revision, delivery result, and moderation action is append-only audit data.

For a missing thread, correct the configuration and allow the scheduler to deliver. For a Discord outage, use `retry` only after the outage clears; repeated retry and delivery operations do not create a second post.

## Website contract

Current members with the configured Guild Player or Administrator role may read:

```text
GET /api/v1/guilds/{guild_id}/player-journals?limit=20
X-Guild-Contract-Version: player-journals.v1
Authorization: Bearer <Discord OAuth token>
```

The response omits the author's Discord user ID and includes only visible, submitted journals attached to the current completed revision.
