import { verifyKey } from "discord-interactions";
import {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  type DiscordInteraction,
} from "./discord";

const MAX_INTERACTION_BYTES = 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function displayName(interaction: DiscordInteraction): string {
  const user = interaction.member?.user ?? interaction.user;
  return user?.global_name ?? user?.username ?? "adventurer";
}

async function readInteractionBody(request: Request): Promise<string | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_INTERACTION_BYTES) {
    return null;
  }

  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_INTERACTION_BYTES) {
      await reader.cancel("Interaction payload is too large");
      return null;
    }

    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    return json({
      name: "DnD New Dawn Guild Assistant",
      status: "ready",
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await readInteractionBody(request);

  if (rawBody === null) {
    return new Response("Payload Too Large", { status: 413 });
  }

  if (
    !signature ||
    !timestamp ||
    !env.DISCORD_PUBLIC_KEY ||
    !(await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY))
  ) {
    return new Response("Invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (interaction.type === InteractionType.Ping) {
    return json({ type: InteractionResponseType.Pong });
  }

  if (
    interaction.type === InteractionType.ApplicationCommand &&
    interaction.data?.name === "ping"
  ) {
    return json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: `🎲 Pong! The guild assistant is awake, ${displayName(interaction)}.`,
        flags: MessageFlags.Ephemeral,
      },
    });
  }

  return json({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content: "I don't recognize that command yet.",
      flags: MessageFlags.Ephemeral,
    },
  });
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
