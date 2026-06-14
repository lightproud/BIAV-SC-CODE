// 自动生成（node build.mjs）。请勿手改，改 config/*.json 后重新生成。
window.GAME_CONFIG = {
  "characters": {
    "_meta": "环行记可玩唤醒体。名录取自 projects/wiki/data/processed/characters.json 解包真实角色；界域归属与天赋为本同人玩法设计（DESIGN §2.4），非游戏正典强度。",
    "characters": [
      {
        "id": "ramona",
        "name": "环行·拉蒙娜",
        "realm": "chaos",
        "title": "回响轮回",
        "startWeapon": "echo_blade",
        "passive": {
          "type": "scaling_damage",
          "value": 0.02,
          "interval": 30
        },
        "passiveDesc": "回响积累：全武器伤害每 30 秒自增 2%。",
        "lore": "复制上回合最后打出的卡牌——从过去的经历中获得力量。"
      },
      {
        "id": "thuru",
        "name": "图鲁",
        "realm": "aequor",
        "title": "外域信使",
        "startWeapon": "tentacle",
        "passive": {
          "type": "extra_projectile",
          "value": 1
        },
        "passiveDesc": "深海眷顾：所有投射类武器投射物 +1。",
        "lore": "侍奉着将在星芒篇收尾的外域存在。"
      },
      {
        "id": "pandia",
        "name": "潘狄娅",
        "realm": "caro",
        "title": "反击之鞭",
        "startWeapon": "thorn_field",
        "passive": {
          "type": "thorns",
          "value": 0.15
        },
        "passiveDesc": "甜蜜鞭笞：受击时反弹 15% 承受伤害给近敌。",
        "lore": "热情的皮囊下，藏匿着恶鬼——造成伤害越高，反击越多。"
      },
      {
        "id": "dores",
        "name": "朵尔·熔毁",
        "realm": "ultra",
        "title": "维度熔毁",
        "startWeapon": "hyper_nova",
        "passive": {
          "type": "area_up",
          "value": 0.2
        },
        "passiveDesc": "维度扩张：所有范围类武器作用半径 +20%。",
        "lore": "原第三部核心角色，独立个人故事已成初稿。"
      }
    ]
  },
  "weapons": {
    "_meta": "环行记武器层。每把武器对应一界域核心机制（DESIGN §2.2）。数值为本同人玩法平衡设计，非游戏正典数值。",
    "weapons": [
      {
        "id": "echo_blade",
        "name": "回响刃",
        "realm": "chaos",
        "behavior": "orbit",
        "desc": "环绕守密人旋转的银钥，复制上一击的余威。",
        "base": {
          "damage": 12,
          "count": 2,
          "radius": 70,
          "rotSpeed": 2.6,
          "tick": 0.25
        },
        "perLevel": {
          "damage": 6,
          "count": 0.5,
          "radius": 6
        },
        "maxLevel": 8
      },
      {
        "id": "tentacle",
        "name": "触腕",
        "realm": "aequor",
        "behavior": "homing",
        "desc": "自深海伸出的触腕，自动锁定最近的融蚀造物。",
        "base": {
          "damage": 16,
          "count": 1,
          "cooldown": 0.9,
          "speed": 320,
          "life": 1.6
        },
        "perLevel": {
          "damage": 7,
          "count": 0.5,
          "cooldown": -0.05
        },
        "maxLevel": 8
      },
      {
        "id": "thorn_field",
        "name": "荆棘场",
        "realm": "caro",
        "behavior": "aura",
        "desc": "贴身荆棘持续撕咬，吞噬敌躯回复生命。",
        "base": {
          "damage": 9,
          "radius": 64,
          "tick": 0.3,
          "lifesteal": 0.06
        },
        "perLevel": {
          "damage": 4,
          "radius": 7
        },
        "maxLevel": 8
      },
      {
        "id": "hyper_nova",
        "name": "超维爆发",
        "realm": "ultra",
        "behavior": "nova",
        "desc": "撕裂维度的放射状能量波，复制自身向四周炸裂。",
        "base": {
          "damage": 22,
          "radius": 130,
          "cooldown": 2.4
        },
        "perLevel": {
          "damage": 9,
          "radius": 14,
          "cooldown": -0.12
        },
        "maxLevel": 8
      },
      {
        "id": "key_shard",
        "name": "银钥碎片",
        "realm": "chaos",
        "behavior": "homing",
        "desc": "混沌银钥裂片，可与任何界域协同射向虚空裂隙。",
        "base": {
          "damage": 14,
          "count": 2,
          "cooldown": 1.1,
          "speed": 280,
          "life": 1.4
        },
        "perLevel": {
          "damage": 6,
          "count": 0.5,
          "cooldown": -0.05
        },
        "maxLevel": 8
      },
      {
        "id": "abyss_pulse",
        "name": "深渊脉冲",
        "realm": "aequor",
        "behavior": "nova",
        "desc": "深海压强骤释，环形冲散逼近之敌。",
        "base": {
          "damage": 18,
          "radius": 110,
          "cooldown": 2
        },
        "perLevel": {
          "damage": 8,
          "radius": 12,
          "cooldown": -0.1
        },
        "maxLevel": 8
      }
    ]
  },
  "enemies": {
    "_meta": "融蚀造物。融蚀（Erosion）= 抹消意义/生命/理智/记忆的核心灾变（morimens-context）。数值为玩法平衡设计。",
    "enemies": [
      {
        "id": "husk",
        "name": "蚀仆",
        "hp": 14,
        "speed": 52,
        "damage": 8,
        "radius": 12,
        "xp": 1,
        "color": "#6b7280",
        "ai": "chase"
      },
      {
        "id": "wisp",
        "name": "速影",
        "hp": 8,
        "speed": 105,
        "damage": 6,
        "radius": 9,
        "xp": 2,
        "color": "#a78bfa",
        "ai": "chase"
      },
      {
        "id": "bloater",
        "name": "壅肿",
        "hp": 60,
        "speed": 34,
        "damage": 18,
        "radius": 20,
        "xp": 4,
        "color": "#dc2626",
        "ai": "chase",
        "onDeath": "burst"
      },
      {
        "id": "weaver",
        "name": "织雾者",
        "hp": 26,
        "speed": 40,
        "damage": 10,
        "radius": 13,
        "xp": 3,
        "color": "#0ea5e9",
        "ai": "ranged",
        "shootCooldown": 2.8,
        "shotSpeed": 155,
        "shotDamage": 8,
        "keepDist": 260
      },
      {
        "id": "erosion_lord",
        "name": "融蚀领主",
        "hp": 3500,
        "speed": 46,
        "damage": 30,
        "radius": 46,
        "xp": 200,
        "color": "#7c3aed",
        "ai": "boss",
        "summon": "husk",
        "summonCooldown": 4,
        "boss": true
      }
    ]
  },
  "waves": {
    "_meta": "生成导演（spawn director）。承接'只增强不削弱'——平衡靠敌人随时间成长，不削玩家。survive=胜利时长(秒)。",
    "survive": 600,
    "hpScalePerMin": 0.1,
    "spawnIntervalBase": 1.2,
    "spawnIntervalMin": 0.5,
    "spawnIntervalDecayPerMin": 0.09,
    "batchBase": 2,
    "batchPerMin": 0.3,
    "maxEnemies": 130,
    "phases": [
      {
        "from": 0,
        "pool": [
          "husk"
        ]
      },
      {
        "from": 60,
        "pool": [
          "husk",
          "wisp"
        ]
      },
      {
        "from": 180,
        "pool": [
          "husk",
          "wisp",
          "bloater"
        ]
      },
      {
        "from": 300,
        "pool": [
          "husk",
          "wisp",
          "bloater",
          "weaver"
        ]
      },
      {
        "from": 450,
        "pool": [
          "husk",
          "wisp",
          "bloater",
          "weaver"
        ]
      }
    ],
    "boss": {
      "at": 600,
      "id": "erosion_lord"
    }
  },
  "upgrades": {
    "_meta": "命运卡（升级池）。trinket 被动取自真实遗物概念。只做加法（只增强不削弱）。",
    "passives": [
      {
        "id": "vigor",
        "name": "灼血护符",
        "stat": "maxHp",
        "value": 30,
        "max": 6,
        "desc": "生命上限 +30"
      },
      {
        "id": "swift",
        "name": "疾行靴",
        "stat": "speed",
        "value": 14,
        "max": 5,
        "desc": "移动速度 +14"
      },
      {
        "id": "might",
        "name": "凶兆指环",
        "stat": "damageMul",
        "value": 0.12,
        "max": 6,
        "desc": "全局伤害 +12%"
      },
      {
        "id": "expanse",
        "name": "扩界之瞳",
        "stat": "areaMul",
        "value": 0.12,
        "max": 5,
        "desc": "作用范围 +12%"
      },
      {
        "id": "haste",
        "name": "回响怀表",
        "stat": "cooldownMul",
        "value": -0.08,
        "max": 5,
        "desc": "攻击冷却 -8%"
      },
      {
        "id": "magnet",
        "name": "灵知磁石",
        "stat": "pickup",
        "value": 30,
        "max": 4,
        "desc": "灵知拾取范围 +30"
      },
      {
        "id": "regen",
        "name": "缝合之心",
        "stat": "regen",
        "value": 0.6,
        "max": 4,
        "desc": "每秒回复生命 +0.6"
      }
    ]
  }
};
