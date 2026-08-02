import { commands } from "./commands.mjs";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID ?? process.env.DISCORD_TEST_GUILD_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const missingVariables = [];
if (!applicationId) missingVariables.push("DISCORD_APPLICATION_ID");
if (!guildId) missingVariables.push("DISCORD_GUILD_ID (or DISCORD_TEST_GUILD_ID)");
if (!botToken) missingVariables.push("DISCORD_BOT_TOKEN");

if (missingVariables.length > 0) {
  console.error(`Missing environment variables: ${missingVariables.join(", ")}`);
  console.error("Copy .dev.vars.example to .dev.vars and fill in the missing values.");
  process.exit(1);
}

const snowflake = /^\d{17,20}$/;
if (!snowflake.test(applicationId) || !snowflake.test(guildId)) {
  console.error(
    "DISCORD_APPLICATION_ID and the target guild ID must be 17–20 digit Discord IDs.",
  );
  process.exit(1);
}

const endpoint =
  `https://discord.com/api/v10/applications/${applicationId}` +
  `/guilds/${guildId}/commands`;

const response = await fetch(endpoint, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

const body = await response.json();
if (!response.ok) {
  console.error(`Discord returned ${response.status}:`, body);
  process.exit(1);
}

console.log("Registered guild-scoped commands:");
for (const command of body) {
  console.log(`- /${command.name} (${command.id})`);
}
