"""Shared Fandom / Bilibili wiki source constants for the fetch_*.py scripts.

These page maps and base URLs were copy-pasted verbatim across
fetch_skills / fetch_cards / fetch_stats / fetch_portraits / fetch_stages /
fetch_wheels. Centralised here so the character maps stay in sync. The
per-script HTTP/parse helpers (api_get / fetch_wikitext / strip_wikimarkup)
have intentionally diverged and remain in their own files.
"""

FANDOM_BASE = "https://forget-last-night-morimens.fandom.com"
FANDOM_ALT = "https://morimens.fandom.com"
BILIGAME_BASE = "https://wiki.biligame.com/morimens"

FANDOM_WIKIS = [
    "https://forget-last-night-morimens.fandom.com",
    "https://morimens.fandom.com",
]

RATE_LIMIT = 0.5

# slug → Fandom wiki page title
PAGE_MAP = {
    "alva": "Alva",
    "doll": "Doll",
    "ramona-timeworn": "Ramona:_Timeworn",
    "ogier": "Ogier",
    "lotan": "Lotan",
    "ramona": "Ramona",
    "pandya": "Pandya",
    "nodera": "Nodera",
    "galen": "Galen",
    "nymphia": "Nymphia",
    "lily": "Lily",
    "danmo": "Danmo",
    "miryam": "Miryam",
    "tulu": "Tulu",
    "divine-king-tulu": "Divine_King_Tulu",
    "celeste": "Celeste",
    "goliath": "Goliath",
    "shan": "Shan",
    "aurita": "Aurita",
    "caecus": "Caecus",
    "faros": "Faros",
    "uvhash": "Uvhash",
    "rhea": "Rhea",
    "sorel": "Sorel",
    "thais": "Thais",
    "alice": "Alice",
    "faint": "Faint",
    "agrippa": "Agrippa",
    "shilo": "Shilo",
    "erica": "Erica",
    "liz": "Liz",
    "daffodil": "Daffodil",
    "winkle": "Winkle",
    "casiah": "Casiah",
    "jenkins": "Jenkins",
    "tincture": "Tincture",
    "horla": "Horla",
    "karen": "Karen",
    "hameln": "Hameln",
    "murphy": "Murphy",
    "salvador": "Salvador",
    "tawil": "Tawil",
    "wanda": "Wanda",
    "aigis": "Aigis",
    "doll-inferno": "Doll:_Inferno",
    "24": "24_(character)",
    "clementine": "Clementine",
    "corposant": "Corposant",
    "kathigu-ra": "Kathigu-Ra",
    "murphy-fauxborn": "Murphy:_Fauxborn",
    "mouchette": "Mouchette",
    "xu": "Xu",
    "castor": "Castor",
    "pollux": "Pollux",
    "helot": "Helot",
    "leigh": "Leigh",
    "doresain": "Doresain",
    "pickman": "Pickman",
    "arachne": "Arachne",
}

# slug → Bilibili wiki page title
BILI_PAGE_MAP = {
    "alva": "阿尔瓦", "doll": "玩偶", "ramona-timeworn": "拉蒙娜·经年",
    "ogier": "奥吉尔", "lotan": "洛坦", "ramona": "拉蒙娜",
    "pandya": "潘迪亚", "nodera": "诺德拉", "galen": "加仑",
    "nymphia": "宁芙", "lily": "莉莉", "danmo": "丹莫",
    "miryam": "弥利亚姆", "tulu": "图鲁", "divine-king-tulu": "图鲁·神王",
    "celeste": "希莱斯特", "goliath": "戈利亚", "shan": "杉",
    "aurita": "奥瑞塔", "caecus": "凯刻斯", "faros": "法罗斯",
    "uvhash": "尤乌哈希", "rhea": "蕾亚", "sorel": "索蕾尔",
    "thais": "塔薇", "alice": "爱丽丝", "faint": "费恩特",
    "agrippa": "阿格里帕", "shilo": "希洛", "erica": "艾瑞卡",
    "liz": "莉兹", "daffodil": "水仙", "winkle": "环娜",
    "casiah": "迦叶", "jenkins": "詹金斯", "tincture": "酊剂",
    "horla": "奥尔拉", "karen": "珈伦", "hameln": "哈姆林",
    "murphy": "墨菲", "salvador": "萨尔瓦多", "tawil": "塔薇儿",
    "wanda": "旺达", "aigis": "艾癸斯", "doll-inferno": "玩偶·炼狱",
    "24": "24", "clementine": "克莱门汀", "corposant": "圣艾尔摩之火",
    "kathigu-ra": "卡蒂古拉", "murphy-fauxborn": "墨菲·诞妄",
    "mouchette": "穆雪特", "xu": "勖", "castor": "卡斯托尔",
    "pollux": "波吕克斯", "helot": "希洛特", "leigh": "莱克",
    "doresain": "多瑞塞", "pickman": "皮克曼", "arachne": "阿拉克涅",
}
