# Combat System

Morimens uses a **turn-based card combat system**. Each turn, you draw cards, spend Arithmetica to play them, and build toward powerful Madness Burst and Key Order activations.

## Turn Structure

Each turn follows this flow:

1. **Draw Phase** -- Draw cards into your hand.
2. **Play Phase** -- Spend Arithmetica to play cards from your hand.
3. **Resolution Phase** -- Card effects resolve; Madness Points and Silver Key update.
4. **Enemy Phase** -- Enemies take their actions.

## Arithmetica (算力)

<span class="arithmetica-cost">Arithmetica</span> is the energy used to play cards.

| Aspect | Value |
|--------|-------|
| Per-turn Arithmetica | **5** |
| Carry over | No (unused Arithmetica is lost at end of turn) |

- Each card has an Arithmetica cost displayed on it.
- You must manage your 5 Arithmetica budget each turn to play the optimal combination of cards.

::: tip
Not every card needs to be played every turn. Sometimes holding a card for a better turn or saving Arithmetica for a combo is the correct play.
:::

## Madness Points (狂气)

Madness Points build during combat and trigger a free ability at 100.

| Aspect | Value |
|--------|-------|
| Trigger Threshold | **100 Madness Points** |
| Cost to Trigger | **Free** (no Arithmetica cost) |
| After Trigger | Resets to 0 and begins building again |

Madness Points accumulate through:
- Taking damage
- Playing certain cards
- Realm-specific effects

When Madness Points reach 100, the active Awakener's **Madness Burst** triggers automatically at no cost.

## Silver Key

Silver Key energy builds during battle toward a powerful Key Order activation.

| Aspect | Value |
|--------|-------|
| Activation Threshold | **1000 Silver Key** |
| Trigger | Manual activation |
| After Trigger | Resets to 0 |

Silver Key accumulates through card play and combat actions. <span class="realm-badge realm-chaos">Chaos</span> realm effects accelerate Silver Key generation.

See [Key Orders](../key-orders/index.md) for details on available Key Order abilities.

## Card Types in Combat

| Card Type | Description | Cost |
|-----------|-------------|------|
| <span class="card-type-badge card-command">Command Card</span> | Core Awakener abilities (4 per character) | Varies (Arithmetica) |
| <span class="card-type-badge card-spirit">Spirit Awakening Card</span> | Powerful signature ability (1 per character) | High Arithmetica cost |
| <span class="card-type-badge card-madness">Madness Burst</span> | Automatic trigger at 100 Madness Points | **Free** |

## Team in Combat

- Up to **4 Awakeners** participate in combat.
- Each Awakener contributes their cards to the shared deck.
- The active Awakener receives Madness Points and can trigger Madness Burst.

## Combat Tips

1. **Plan your Arithmetica** -- With 5 per turn, prioritize high-impact cards.
2. **Track Madness Points** -- Know when Madness Burst will trigger to time it with your strategy.
3. **Build Silver Key** -- In longer fights, reaching 1000 Silver Key for a Key Order can be the deciding factor.
4. **Match realms** -- Realm synergy bonuses apply in combat. See [Realms](../realms/index.md).
5. **Upgrade cards** -- Higher card levels dramatically increase combat effectiveness. See [Card Upgrades](../cards/upgrade.md).

## See Also

- [Card System](../cards/index.md)
- [Realms Overview](../realms/index.md)
- [Key Orders](../key-orders/index.md)
- [Team Building](../awakeners/team-building.md)
