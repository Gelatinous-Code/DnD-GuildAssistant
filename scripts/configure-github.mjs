import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const configUrl = new URL("../.github/repository.json", import.meta.url);
const config = JSON.parse(readFileSync(fileURLToPath(configUrl), "utf8"));

function gh(args, options = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });

  if (result.error?.code === "ENOENT") {
    console.error("GitHub CLI is required: https://cli.github.com/");
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout?.trim();
}

const repository = gh(
  ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
  { capture: true },
);

if (!repository) {
  console.error("Could not determine the GitHub repository from the current remote.");
  process.exit(1);
}

console.log("Configuring " + repository + "...");

for (const topic of config.topics) {
  gh(["repo", "edit", repository, "--add-topic", topic]);
}

for (const label of config.labels) {
  gh([
    "label",
    "create",
    label.name,
    "--repo",
    repository,
    "--color",
    label.color,
    "--description",
    label.description,
    "--force",
  ]);
}

console.log("Repository topics and labels are configured.");
console.log("Next: enable private vulnerability reporting and branch protection in GitHub Settings.");
