# Automatic pre-session table threads

Once a published table is available for player selection, the scheduled Worker
creates one Discord thread for that event/table and DMs the current DM a button
that opens it while signed into Discord.

The thread name includes the local session date, game tier, table number, and
DM. In a text or announcement channel, the published table message is the
thread's anchor. In a forum or media channel, the bot creates a forum post with
a short placeholder.

## What the DM receives

The private message includes the game time, the table-selection deadline, the
thread link, and a lightweight starter checklist. The DM remains in control of
the adventure description and any questions such as level, HP, passive
Perception, or adventure-specific details.

The bot deliberately does not add or mention players. The DM adds or tags the
current roster only after the introduction is ready.

If the assigned DM changes, the existing thread remains canonical and the bot
sends the new DM a fresh link. It does not create a duplicate thread.

## Administrator controls

`/table-thread-admin status table_number:{number}` shows the current state,
generation, DM revision, retry time, error type, and thread link.

`/table-thread-admin manage` requires Manage Server, a reason, and explicit
confirmation. Actions are:

- `retry`: recover a failed creation or DM delivery;
- `recreate`: archive the old thread, optionally redirect to another supported
  channel, create a fresh generation, and notify the current DM; or
- `cancel`: stop automation for that table and archive/lock an existing thread.

Every manual change is stored in the D1 audit history. Discord outages and
permission failures are retried with bounded backoff; thread/message recovery
prevents duplicate creation after an ambiguous API response.

## Discord permissions

In the configured parent channel, grant the bot View Channel, Send Messages,
Read Message History, Create Public Threads, and Send Messages in Threads.
Grant Manage Threads if administrators should be able to archive and lock old
threads through the repair command. Forum/media parents also need permission to
create posts. Do not grant Discord Administrator.
