import { describe, expect, it } from "vitest";
import {
  diagnoseChannelPermissions,
  diagnoseInteractionPermissions,
  effectiveChannelPermissions,
  renderReminderTemplate,
  validateGuildSchedule,
  validateReminderTemplate,
  validateTablePolicy,
} from "../src/policy";

describe("configuration policy", () => {
  it("validates ordered table constraints", () => {
    expect(validateTablePolicy({ minimum: 4, preferred: 6, maximum: 6 })).toEqual([]);
    expect(validateTablePolicy({ minimum: 7, preferred: 6, maximum: 5 })).toEqual([
      "minimum table size cannot exceed preferred table size",
      "preferred table size cannot exceed maximum table size",
    ]);
  });

  it("validates guild-local schedules and lead windows", () => {
    expect(
      validateGuildSchedule({
        timezone: "America/Denver",
        weeklyDay: 6,
        weeklyTime: "18:30",
        signupOpenLeadDays: 7,
        signupLockLeadHours: 24,
      }),
    ).toEqual([]);
    expect(
      validateGuildSchedule({
        timezone: "Nope/Nowhere",
        weeklyDay: 9,
        weeklyTime: "soon",
        signupOpenLeadDays: 0,
        signupLockLeadHours: 200,
      }),
    ).toEqual(expect.arrayContaining([
      "weekday must be an integer from 1 (Monday) through 7 (Sunday)",
      "time must use 24-hour HH:mm format",
      "time zone 'Nope/Nowhere' is not a valid IANA time zone",
      "signup lead must be an integer from 1 through 7 days in the weekly MVP scheduler",
      "lock lead must be positive and no longer than the signup window",
    ]));
  });
});

describe("reminder policy", () => {
  it("rejects hostile mention content and unsupported tokens", () => {
    expect(validateReminderTemplate("Hi @everyone <@123> {secret}")).toEqual([
      "reminder text cannot contain @everyone, @here, or raw user/role mentions; choose the configured role option instead",
      "unsupported reminder token {secret}",
    ]);
  });

  it("renders only documented tokens", () => {
    expect(
      renderReminderTemplate(
        "{event}: {players} players, {gms} GMs, {open_seats} open at {when}.",
        {
          event: "Saturday games",
          when: "6:30 PM",
          players: 11,
          gms: 2,
          openSeats: 1,
        },
      ),
    ).toBe("Saturday games: 11 players, 2 GMs, 1 open at 6:30 PM.");
  });
});

describe("permission diagnostics", () => {
  it("separates required failures from optional warnings", () => {
    const sendAndView = String((1n << 10n) | (1n << 11n));
    const diagnostics = diagnoseInteractionPermissions(sendAndView);

    expect(diagnostics.find(({ name }) => name === "View Channels")?.level).toBe("pass");
    expect(diagnostics.find(({ name }) => name === "Embed Links")?.level).toBe("failure");
    expect(diagnostics.find(({ name }) => name === "Attach Files")?.level).toBe("warning");
  });

  it("resolves everyone, combined-role, and member channel overwrites in Discord order", () => {
    const view = 1n << 10n;
    const send = 1n << 11n;
    const embed = 1n << 14n;
    const history = 1n << 16n;
    const base = view | send | embed | history;
    const effective = effectiveChannelPermissions({
      guildId: "10",
      roles: [
        {
          id: "10",
          name: "@everyone",
          color: 0,
          position: 0,
          permissions: String(base),
          managed: false,
          mentionable: false,
        },
        {
          id: "20",
          name: "Assistant A",
          color: 0,
          position: 1,
          permissions: "0",
          managed: true,
          mentionable: false,
        },
        {
          id: "30",
          name: "Assistant B",
          color: 0,
          position: 2,
          permissions: "0",
          managed: false,
          mentionable: false,
        },
      ],
      botMember: {
        roles: ["20", "30"],
        user: { id: "99", username: "Guild Assistant", bot: true },
      },
      channel: {
        id: "200",
        type: 0,
        guild_id: "10",
        permission_overwrites: [
          { id: "10", type: 0, allow: "0", deny: String(send) },
          { id: "20", type: 0, allow: String(send), deny: String(embed) },
          { id: "30", type: 0, allow: String(embed), deny: "0" },
          { id: "99", type: 1, allow: "0", deny: String(view) },
        ],
      },
    });

    expect(effective & view).toBe(0n);
    expect(effective & send).toBe(send);
    expect(effective & embed).toBe(embed);
    expect(effective & history).toBe(history);
    const diagnostics = diagnoseChannelPermissions(effective);
    expect(diagnostics.find(({ name }) => name === "View Channels")?.level).toBe("failure");
    expect(diagnostics.find(({ name }) => name === "Send Messages")?.level).toBe("pass");
    expect(diagnostics.find(({ name }) => name === "Embed Links")?.level).toBe("pass");
    expect(diagnostics.some(({ name }) => name === "Manage Roles")).toBe(false);
  });

  it("treats Administrator as bypassing channel overwrites", () => {
    const effective = effectiveChannelPermissions({
      guildId: "10",
      roles: [
        {
          id: "10",
          name: "@everyone",
          color: 0,
          position: 0,
          permissions: "0",
          managed: false,
          mentionable: false,
        },
        {
          id: "20",
          name: "Administrator",
          color: 0,
          position: 1,
          permissions: String(1n << 3n),
          managed: false,
          mentionable: false,
        },
      ],
      botMember: {
        roles: ["20"],
        user: { id: "99", username: "Guild Assistant", bot: true },
      },
      channel: {
        id: "200",
        type: 0,
        guild_id: "10",
        permission_overwrites: [
          { id: "10", type: 0, allow: "0", deny: String((1n << 63n) - 1n) },
          { id: "99", type: 1, allow: "0", deny: String((1n << 63n) - 1n) },
        ],
      },
    });

    expect(diagnoseChannelPermissions(effective).every(({ level }) => level === "pass")).toBe(
      true,
    );
  });
});
