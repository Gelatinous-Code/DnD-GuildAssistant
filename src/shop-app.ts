import type { DiscordInteraction } from "./discord";
import {
  booleanOption,
  ephemeral,
  invokingUserId,
  isGuildAdmin,
  numberOption,
  parseCommand,
  requireGuild,
  stringOption,
  UserFacingError,
} from "./interaction-utils";
import { ShopRuleError, ShopService, type ShopEligibility } from "./shop-service";

function text(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new UserFacingError(`${label} is required.`);
  return value.trim();
}

function whole(value: number | undefined, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value)) throw new UserFacingError(`${label} must be a whole number.`);
  return value!;
}

function price(value: number): string {
  return value === 0 ? "FREE" : `${value.toLocaleString()} gp`;
}

function confirmComponents(previewId: string): Record<string, unknown>[] {
  return [{
    type: 1,
    components: [{
      type: 2,
      style: 3,
      label: "Seal the bargain",
      emoji: { name: "🪙" },
      custom_id: `shop:confirm:${previewId}`,
    }],
  }];
}

export async function handleShopCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const invocation = parseCommand(interaction);
  if (invocation.command !== "shop" && invocation.command !== "shop-admin") return null;
  try {
    const guildId = requireGuild(interaction);
    const actorUserId = invokingUserId(interaction);
    if (!actorUserId) throw new UserFacingError("Discord did not identify the member.");
    const shop = new ShopService(env.DB);

    if (invocation.command === "shop-admin") {
      if (!isGuildAdmin(interaction)) {
        throw new UserFacingError("This command requires Manage Server permission.");
      }
      if (invocation.subcommand === "item") {
        const tags = (stringOption(invocation, "tags") ?? "")
          .split(",").map((tag) => tag.trim()).filter(Boolean);
        const item = await shop.upsertItem({
          guildId,
          itemId: text(stringOption(invocation, "item_id"), "Item ID").toLowerCase(),
          name: text(stringOption(invocation, "name"), "Name"),
          category: text(stringOption(invocation, "category"), "Category"),
          description: text(stringOption(invocation, "description"), "Description"),
          priceGold: whole(numberOption(invocation, "price_gold"), "Price"),
          eligibility: (stringOption(invocation, "eligibility") ?? "all") as ShopEligibility,
          repeatRule: stringOption(invocation, "repeat_rule") === "once_per_character"
            ? "once_per_character" : "repeatable",
          maxQuantity: numberOption(invocation, "max_quantity") ?? null,
          minimumLevel: numberOption(invocation, "minimum_level") ?? null,
          maximumLevel: numberOption(invocation, "maximum_level") ?? null,
          contractConsumable: booleanOption(invocation, "contract_consumable") ?? false,
          tags,
          source: stringOption(invocation, "source") ?? null,
          rarity: stringOption(invocation, "rarity") ?? null,
          requiresAttunement: booleanOption(invocation, "attunement") ?? false,
          actorUserId,
          reason: text(stringOption(invocation, "reason"), "Reason"),
        });
        return ephemeral(
          `✅ Stocked **${item.name}** as \`${item.itemId}\` for ${price(item.priceGold)}. ` +
          `Catalog revision ${item.catalogRevision}; item revision ${item.itemRevision}.`,
        );
      }
      if (invocation.subcommand === "active") {
        const item = await shop.setItemActive({
          guildId,
          itemId: text(stringOption(invocation, "item_id"), "Item ID"),
          active: booleanOption(invocation, "active") ?? true,
          actorUserId,
          reason: text(stringOption(invocation, "reason"), "Reason"),
        });
        return ephemeral(`✅ **${item.name}** is now ${item.active ? "available" : "deactivated"}.`);
      }
      if (invocation.subcommand === "eligibility") {
        await shop.grantEligibility({
          guildId,
          characterId: text(stringOption(invocation, "character_id"), "Character ID"),
          actorUserId,
          reason: text(stringOption(invocation, "reason"), "Reason"),
        });
        return ephemeral("✅ Artificer shop eligibility recorded for that character.");
      }
      if (invocation.subcommand === "reverse") {
        const receipt = await shop.reversePurchase({
          guildId,
          receiptId: text(stringOption(invocation, "receipt_id"), "Receipt ID"),
          actorUserId,
          reason: text(stringOption(invocation, "reason"), "Reason"),
        });
        return ephemeral(
          `↩️ Receipt \`${receipt.receiptId}\` is reversed. ${receipt.totalGold} gp was restored.`,
        );
      }
      if (invocation.subcommand === "configure") {
        await shop.configure({
          guildId,
          actorUserId,
          shopkeeperName: stringOption(invocation, "shopkeeper"),
          welcomeMessage: stringOption(invocation, "welcome"),
          maintenanceMode: booleanOption(invocation, "maintenance"),
        });
        const config = await shop.getConfig(guildId);
        return ephemeral(
          `✅ Shop configured: **${config!.shopkeeperName}** · revision ${config!.catalogRevision}` +
          `${config!.maintenanceMode ? " · maintenance mode" : ""}.`,
        );
      }
      if (invocation.subcommand === "status") {
        const config = await shop.getConfig(guildId);
        const counts = await shop.catalogCounts(guildId);
        return ephemeral(config
          ? `**Shop status** · revision ${config.catalogRevision} · ${counts.active}/${counts.total} loaded items active` +
            `${config.maintenanceMode ? " · maintenance mode" : ""}`
          : "The shop is not configured yet.");
      }
      throw new UserFacingError("Choose a shop-admin action.");
    }

    const config = await shop.getConfig(guildId);
    if (config?.maintenanceMode) throw new UserFacingError("The shopkeeper has stepped away for maintenance.");
    if (invocation.subcommand === "browse") {
      const items = await shop.listCatalog({
        guildId,
        query: stringOption(invocation, "query"),
        category: stringOption(invocation, "category"),
        tag: stringOption(invocation, "tag"),
        free: booleanOption(invocation, "free"),
        limit: 10,
      });
      if (!items.length) return ephemeral("🕸️ The shelf is bare for those filters.");
      const lines = items.map((item) =>
        `• **${item.name}** — ${price(item.priceGold)} · ${item.category}` +
        `${item.eligibility === "artificer" ? " · Artificer only" : ""}` +
        `\n  ${item.description.slice(0, 180)} · \`${item.itemId}\``,
      );
      return ephemeral(
        `**${config?.shopkeeperName ?? "The Quartermaster"}**
*${config?.welcomeMessage ?? "Mind the mimics, adventurer."}*

${lines.join("\n").slice(0, 1_750)}

Use \`/shop buy\` with an item and one of your approved character IDs.`,
      );
    }
    if (invocation.subcommand === "buy") {
      const firstItemId = text(stringOption(invocation, "item_id"), "Item ID");
      const secondItemId = stringOption(invocation, "item_id_2")?.trim();
      const items = [{
        itemId: firstItemId,
        quantity: whole(numberOption(invocation, "quantity"), "Quantity", 1),
      }];
      if (secondItemId) items.push({
        itemId: secondItemId,
        quantity: whole(numberOption(invocation, "quantity_2"), "Second quantity", 1),
      });
      const preview = await shop.createCartPreview({
        guildId,
        userId: actorUserId,
        characterId: text(stringOption(invocation, "character_id"), "Character ID"),
        items,
      });
      return ephemeral(
        `🧾 **A bargain awaits**
${preview.quantity} × **${preview.itemName}** for **${price(preview.totalGold)}**
Buyer: **${preview.characterName}** · purse: ${preview.balanceGold} gp
After purchase: **${preview.balanceGold - preview.totalGold} gp**

The shopkeeper will hold this offer for 10 minutes.`,
        { components: confirmComponents(preview.previewId) },
      );
    }
    if (invocation.subcommand === "history") {
      const receipts = await shop.listReceipts(
        guildId,
        actorUserId,
        stringOption(invocation, "character_id"),
      );
      return ephemeral(receipts.length
        ? `**Your recent shop receipts**
${receipts.map((receipt) =>
  `• ${receipt.quantity} × **${receipt.itemName}** · ${price(receipt.totalGold)}` +
  ` · ${receipt.status} · \`${receipt.receiptId}\``,
).join("\n").slice(0, 1_850)}`
        : "You have no shop receipts yet.");
    }
    if (invocation.subcommand === "characters") {
      const characters = await shop.approvedCharacters(guildId, actorUserId);
      return ephemeral(characters.length
        ? `**Characters eligible to shop**
${characters.map((character) =>
  `• **${character.name}**${character.isMain ? " — main" : ""} · \`${character.characterId}\``,
).join("\n")}`
        : "You have no active, approved characters eligible to shop.");
    }
    throw new UserFacingError("Choose a shop action.");
  } catch (error) {
    if (error instanceof ShopRuleError || error instanceof TypeError || error instanceof RangeError) {
      throw new UserFacingError(error.message);
    }
    throw error;
  }
}

export async function handleShopInteraction(
  interaction: DiscordInteraction,
  env: Env,
): Promise<Response | null> {
  const customId = interaction.data?.custom_id;
  if (!customId?.startsWith("shop:confirm:")) return null;
  const guildId = requireGuild(interaction);
  const userId = invokingUserId(interaction);
  if (!userId) throw new UserFacingError("Discord did not identify the member.");
  try {
    const receipt = await new ShopService(env.DB).confirmPurchase({
      guildId,
      userId,
      previewId: customId.slice("shop:confirm:".length),
    });
    return ephemeral(
      `🔔 **Sold!** ${receipt.quantity} × **${receipt.itemName}** for ${price(receipt.totalGold)}.
Receipt: \`${receipt.receiptId}\`
${receipt.totalGold === 0 ? "No gold changed hands." : "Your shared progression balance has been updated."}
Remember to add the item${receipt.quantity === 1 ? "" : "s"} to your character sheet.`,
      { components: [] },
    );
  } catch (error) {
    if (error instanceof ShopRuleError) throw new UserFacingError(error.message);
    throw error;
  }
}
