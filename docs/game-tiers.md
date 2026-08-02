# Weekly game tiers

New Dawn uses three game tiers:

| Weekly choice | Character levels |
| --- | --- |
| Tier 1 | Levels 3–4 |
| Tier 2 | Levels 5–7 |
| Tier 3 | Levels 8+ |

The assistant stores a member's tier on that week's signup. It does not create a
permanent character profile, change Discord roles, or try to level a character
automatically.

## Player signup

The weekly signup post has **Play T1**, **Play T2**, and **Play T3** buttons.
Choose the tier your character will play that week.

- Choosing another tier updates the same weekly signup.
- Choosing **Withdraw** removes the weekly signup.
- The saved tier stays with the week's roster and CSV export.
- A player can choose and waitlist only for tables in that tier.

Players do not need to maintain a separate profile. If an unusual balancing
decision moves someone down a tier, an organizer can correct that week's signup.

## GM signup

The weekly signup post has **Run T1**, **Run T2**, **Run T3**, and **Backup GM**
buttons.

- A tier choice means the GM is offering a planned table in that tier.
- **Backup GM** records availability without creating table capacity.
- Choosing another option updates the same weekly signup.
- GM rotation history is still considered, but only GMs offering the table's
  tier compete for that tier's planned tables.

## Planning and waitlists

The planner handles each tier independently and then combines the results into
one weekly plan.

- GM coverage and table capacity do not move between tiers.
- Signup-order reservations and the bench restart within each tier.
- A Tier 1 drop promotes the first Tier 1 bench player, not the first player
  from another tier.
- Table waitlists and DM-priority tokens cannot cross tiers.
- After open seating begins, a player may claim any open table in their own
  weekly tier.

Table cards and private promotion notices show the tier explicitly.

## Organizer corrections

Use the weekly correction command when a member clicked the wrong tier or an
organizer approved a rare balancing change:

    /week signup member:@Member kind:Player tier:Tier 2
    /week signup member:@Member kind:GM tier:Tier 1
    /week signup member:@Member kind:Backup GM
    /week signup member:@Member kind:Withdraw

The **tier** option is required for **Player** and **GM**. It is not used for
**Backup GM** or **Withdraw**.

If tier support is deployed while a week already has active signups, the signup
post lists those older entries under **Needs a tier**. Ask those members to click
a tier button, or correct them with **/week signup**, before generating the plan.
The planner refuses to guess.

## CSV export

Tier support changes the roster export schema to **weekly-roster-v2** and adds:

- **game_tier**
- **gm_commitment**

**gm_commitment** is **primary** for a tiered GM signup and **backup** for a
backup offer. It is blank for players.
