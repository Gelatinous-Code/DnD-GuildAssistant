# Player and GM guide

This guide is for ordinary Discord members. Everything here happens in Discord.
There is nothing to download, install, or configure.

If you get lost, run `/help`. The response is private.

## Sign up for the week

The weekly signup post changes as the week moves forward.

- To run a game, click **Run a Game** after GM signup opens.
- To play, click **Play** after player signup opens.
- To drop out of the whole week, click **Withdraw**.

Clicking the same signup choice again is safe. The bot will not count you twice.
If you change from GM to player, choose the new option on the signup post.

## Choose a table

When the bot publishes tables, click **Join** on the table you want.

- If the table has room and you have a reserved place for the week, you are
  seated.
- If that table is full, you join that table's waitlist.
- If every weekly place was already reserved before you signed up, the bot tells
  you that you are on the global waitlist.

The two leave actions mean different things:

- **Leave Table** removes only your table choice. You still intend to play that
  week.
- **Withdraw** removes you from the whole week. Before open seating, the next
  person on the global waitlist may inherit your reserved place.

When open seating begins, any remaining places become first-come,
first-served. Not choosing a table before then is not a punishment or a no-show;
it only means the earlier reservation no longer protects an unclaimed place.

At game time, table buttons close and the bot posts the final roster.

## If you are selected as a GM

The bot chooses enough GMs for the available players using the guild's published
rotation policy. Volunteering does not guarantee selection every week.

If your availability changes, use **Withdraw** as early as possible and tell an
organizer. Organizers have an audited correction process when a published plan
must change.

Read the [GM selection policy](gm-priority-policy.md) if you want the exact
ranking and tie-break rules.

## DM priority tokens

After a game ends, an organizer confirms which tables ran and who actually
participated. An eligible DM receives two priority tokens. A token can protect a
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
global weekly waitlist, and open seating. If the public roster still looks
wrong, ask an organizer to check `/week status`.

### I did not receive a token message

Run `/priority status`. The token record does not depend on delivery of the
private message. An organizer can check private diagnostics without publishing
your history.

### I need help from a person

Tell an organizer what action you attempted and the wording of the error. Never
send anyone your Discord token, bot token, or private priority history.
