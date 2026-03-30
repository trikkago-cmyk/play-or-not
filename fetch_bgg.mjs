import fs from 'fs';

const games = [
    ["卡卡颂", "Carcassonne"],
    ["璀璨宝石", "Splendor"],
    ["车票之旅", "Ticket to Ride"],
    ["七大奇迹", "7 Wonders"],
    ["农场主", "Agricola"],
    ["展翅翱翔", "Wingspan"],
    ["沙丘：帝国", "Dune Imperium"],
    ["波多黎各", "Puerto Rico"],
    ["阿瓦隆", "The Resistance Avalon"],
];

async function main() {
    for (const [cn, en] of games) {
        try {
            const bggSearchUrl = `https://boardgamegeek.com/xmlapi2/search?query=${encodeURIComponent(en)}&type=boardgame`;
            const bggSearchRes = await fetch(bggSearchUrl);
            const bggSearchText = await bggSearchRes.text();

            const idMatch = bggSearchText.match(/<item type="boardgame" id="(\d+)"/);
            if (idMatch) {
                let id = idMatch[1];
                const thingUrl = `https://boardgamegeek.com/xmlapi2/thing?id=${id}`;
                const thingRes = await fetch(thingUrl);
                const thingText = await thingRes.text();
                const coverMatch = thingText.match(/<image>(.*?)<\/image>/);
                if (coverMatch) {
                    console.log(`[${cn}] -> ${coverMatch[1]}`);
                } else {
                    console.log(`[${cn}] -> No Cover Image Found in XML`);
                }
            } else {
                console.log(`[${cn}] -> No Match in Search`);
            }
        } catch (e) { console.log('Error for', en); }
        await new Promise(r => setTimeout(r, 1000));
    }
}

main();
