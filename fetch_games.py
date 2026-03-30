import requests
import urllib.parse
import re
import xml.etree.ElementTree as ET
import time

games = [
    ("卡卡颂", "Carcassonne"),
    ("璀璨宝石", "Splendor"),
    ("车票之旅", "Ticket to Ride"),
    ("七大奇迹", "7 Wonders"),
    ("农场主", "Agricola"),
    ("展翅翱翔", "Wingspan"),
    ("沙丘：帝国", "Dune: Imperium"),
    ("镰刀战争", "Scythe"),
    ("波多黎各", "Puerto Rico"),
    ("勃艮第城堡", "The Castles of Burgundy"),
]

headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
}

results = []

for cn_name, en_name in games:
    print(f"Fetching {cn_name}...")
    
    # 1. Fetch Bilibili BV
    url = f"https://search.bilibili.com/all?keyword={urllib.parse.quote(cn_name + ' 桌游教学')}"
    r = requests.get(url, headers=headers)
    matches = re.findall(r'BV[1-9A-HJ-NP-Za-km-z]{10}', r.text)
    bv_id = matches[0] if matches else "NOT_FOUND"

    # 2. Fetch BGG Cover
    search_url = f"https://boardgamegeek.com/xmlapi2/search?query={urllib.parse.quote(en_name)}&type=boardgame&exact=1"
    bgg_r = requests.get(search_url)
    try:
        root = ET.fromstring(bgg_r.content)
        items = root.findall("item")
        if not items:
            # Fallback to non-exact
            search_url = f"https://boardgamegeek.com/xmlapi2/search?query={urllib.parse.quote(en_name)}&type=boardgame"
            bgg_r = requests.get(search_url)
            root = ET.fromstring(bgg_r.content)
            items = root.findall("item")
        
        bg_id = items[0].get('id') if items else None
        cover_url = ""
        if bg_id:
            thing_url = f"https://boardgamegeek.com/xmlapi2/thing?id={bg_id}"
            thing_r = requests.get(thing_url)
            thing_root = ET.fromstring(thing_r.content)
            image = thing_root.find(".//image")
            if image is not None:
                cover_url = image.text
    except Exception as e:
        cover_url = str(e)

    results.append({
        "cn_name": cn_name,
        "en_name": en_name,
        "bv_id": bv_id,
        "cover_url": cover_url
    })
    time.sleep(1)

for r in results:
    print(r)

