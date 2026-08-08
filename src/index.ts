import { verifyKey } from "discord-interactions";
import {
  InteractionResponseType,
  InteractionType,
  type DiscordInteraction,
} from "./discord";
import { handleDiscordInteraction, handleScheduled } from "./app";
import { handleShopPublicApi } from "./shop-public-api";
import { handleWebsiteReadRequest } from "./website-read-model";
import { handleWebsiteLibraryReadRequest } from "./website-library-read-model";

export { WebsiteManagementApi } from "./website-management-entrypoint";

const MAX_INTERACTION_BYTES = 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
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

export async function handleRequest(
  request: Request,
  env: Env,
  context?: ExecutionContext,
): Promise<Response> {
  if (request.method === "GET") {
    const catalogResponse = await handleShopPublicApi(request, env);
    if (catalogResponse !== null) return catalogResponse;
    const libraryResponse = await handleWebsiteLibraryReadRequest(request, env);
    if (libraryResponse !== null) return libraryResponse;
    const websiteResponse = await handleWebsiteReadRequest(request, env);
    if (websiteResponse !== null) return websiteResponse;
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

  return handleDiscordInteraction(interaction, env, context);
}

export default {
  fetch: handleRequest,
  scheduled(controller, env, context) {
    context.waitUntil(handleScheduled(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
