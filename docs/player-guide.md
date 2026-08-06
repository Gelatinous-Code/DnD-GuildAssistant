# Player and GM guide

This guide is for ordinary Discord members. Everything here happens in Discord.
There is nothing to download, install, or configure.

If you get lost, run `/help`. The response is private.

## Sign up for the week

The weekly signup post changes as the week moves forward.

- To run a game, click **Run T1**, **Run T2**, or **Run T3** for the tier you
  will run after GM signup opens. Choose **Backup GM** only when you can cover a
  late absence but are not offering another planned table.
- To play, click **Play T1**, **Play T2**, or **Play T3** for your character's
  level after player signup opens: Tier 1 is levels 3–4, Tier 2 is levels 5–7,
  and Tier 3 is level 8+.
- To drop out of the whole week, click **Withdraw**.

Clicking the same signup choice again is safe. The bot will not count you twice.
If you change from GM to player, choose the new option on the signup post.

## Choose a table

When the bot publishes tables, click **Join** on the table you want.

- If the table has room and you have a reserved place for the week, you are
  seated.
- If that table is full, you join that table's waitlist.
- If every weekly place was already reserved before you signed up, the bot tells
  you that you are on your tier's weekly waitlist.

The two leave actions mean different things:

- **Leave Table** removes only your table choice. You still intend to play that
  week.
- **Withdraw** removes you from the whole week. Before open seating, the next
  person waiting in the same tier may inherit your reserved place.

When open seating begins, any remaining places become first-come,
first-served. Not choosing a table before then is not a punishment or a no-show;
it only means the earlier reservation no longer protects an unclaimed place.

At game time, table buttons close and the bot posts the final roster.

## If you are selected as a GM

The bot chooses enough GMs for the available players using the guild's published
rotation policy. Planning and GM selection happen separately within each tier.
Volunteering does not guarantee selection every week. A **Backup GM** signup is
visible to organizers but does not add player capacity.

If your availability changes, use **Withdraw** as early as possible and tell an
organizer. Organizers have an audited correction process when a published plan
must change.

Read the [GM selection policy](gm-priority-policy.md) if you want the exact
ranking and tie-break rules. See [Weekly game tiers](game-tiers.md) for tier
choices, corrections, and same-tier waitlist behavior.

## When your table is published

The bot creates the table discussion and privately sends the selected DM an **Open thread** button. The DM writes the adventure description and any character questions in their own style. The bot does not add or mention players; the DM tags the current roster only after the introduction is ready.

## After you run a session

When the guild enables the recap workflow after approving an incentive, the bot sends the recorded DM a private **Write session summary** button. Include a short public summary, the area, important events, bonus gold or items, and any other useful notes. The on-time deadline is 72 hours after the session; the bot sends one reminder after 48 hours. Your first submission remains editable for seven days. If DMs are blocked, use `/recap pending`; if the table did not run, use the guarded **Session did not run** button instead of writing notes.

No summary incentive has been approved yet. Submitting on time is recorded, but it does not currently award gold, XP, or tokens. See [session summaries](session-summaries.md) for the exact policy.

## DM priority tokens

After an archived game ends, the bot assumes each finalized table ran unless an organizer records a cancellation or correction. An eligible actual DM receives two priority tokens. A token can protect a
player seat in a later week.

The member commands are:

| Discord command | What it does |
| --- | --- |
| `/priority status` | Privately shows your available tokens and dates. |
| `/priority use` | Previews what will happen at a published table, then asks you to confirm with a private button. |
| `/priority release` | Stops using a reserved token while keeping your ordinary table request. |

Using priority may move another player to a waitlist when a table is full. The
preview names the result before you confirm. The
[DM priority token policy](dm-priority-token-policy.md) explains earning,
expiration, displacement, refunds, and ties.

## Common questions

### The bot looks offline

That can be normal for this bot. Try `/help` or `/ping`; its member-list presence
is not its health indicator.

### A button says it is old or no longer recognized

Use the newest signup or table message. If there is no newer message, tell an
organizer which post you clicked. Do not keep clicking an old control.

### I expected a seat but I am waiting

Read the bot's private response first. It will distinguish a full table, the
your tier's weekly waitlist, and open seating. If the public roster still looks
wrong, ask an organizer to check `/week status`.

### I did not receive a token message

Run `/priority status`. The token record does not depend on delivery of the
private message. An organizer can check private diagnostics without publishing
your history.

### I need help from a person

Tell an organizer what action you attempted and the wording of the error. Never
send anyone your Discord token, bot token, or private priority history.
