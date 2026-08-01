import { commands } from "./commands.mjs";

const requiredVariables = [
  "DISCORD_APPLICATION_ID",
  "DISCORD_TEST_GUILD_ID",
  "DISCORD_BOT_TOKEN",
];

const missingVariables = requiredVariables.filter((name) => !process.env[name]);
if (missingVariables.length > 0) {
  console.error(`Missing environment variables: ${missingVariables.join(", ")}`);
  console.error("Copy .dev.vars.example to .dev.vars and fill in the missing values.");
  process.exit(1);
}

const endpoint =
  `https://discord.com/api/v10/applications/${process.env.DISCORD_APPLICATION_ID}` +
  `/guilds/${process.env.DISCORD_TEST_GUILD_ID}/commands`;

const response = await fetch(endpoint, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

const body = await response.json();
if (!response.ok) {
  console.error(`Discord returned ${response.status}:`, body);
  process.exit(1);
}

console.log("Registered test-guild commands:");
for (const command of body) {
  console.log(`- /${command.name} (${command.id})`);
}
