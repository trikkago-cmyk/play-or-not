# Title Localization Audit - 2026-05-13

## Snapshot

- Recommendation-tier games: `500`
- Initial entries where `titleCn === titleEn`: `76`
- Backfilled in earlier passes: `76`
- Current entries where `titleCn === titleEn`: `0`
- Current user-facing guardrail: no full-tier recommendation title is currently English-only by direct `titleCn === titleEn` audit

## Current Verification - 2026-05-13 22:45 CST

- `npm run kb:localize` reported `localized title entries: 0`.
- `src/data/__tests__/gameDatabase.test.ts` now requires zero untranslated full-tier user-facing titles.
- Direct TS audit reported:
  - `fullTier: 500`
  - `untranslatedUserFacingTitles: 0`

## Historical Backfill List

- `keyflower`: `Keyflower` -> `大五月花号`
- `secretmoon`: `Secret Moon` -> `秘密月亮`
- `arctic`: `Arctic` -> `北极`
- `afterus`: `After Us` -> `在我们之后`
- `bang`: `BANG!` -> `砰！`
- `botanicus`: `Botanicus` -> `植梦花园`
- `soluna`: `Soluna` -> `日月棋`
- `boreal`: `Boreal` -> `北境`
- `coffeerush`: `Coffee Rush` -> `咖啡狂热`
- `myshelfie`: `My Shelfie` -> `书柜、植栽、我的猫`
- `nextstation`: `Next Station: London` -> `下一站：伦敦`
- `odin`: `Odin` -> `奥丁`
- `thirteenclues`: `13 Clues` -> `13道线索`
- `microdojo`: `Micro Dojo` -> `微型道场`
- `tinyfarms`: `Tiny Farms` -> `迷你农场`
- `agentavenue`: `Agent Avenue` -> `特工大道`
- `myshelfiedice`: `My Shelfie: The Dice Game` -> `书柜、植栽、我的猫：骰子版`
- `jurassicsnack`: `Jurassic Snack` -> `恐龙小吃`
- `pocketcats`: `Pocket Cats` -> `口袋猫猫`
- `fika`: `Fika` -> `菲卡`
- `leaders`: `Leaders` -> `领袖`
- `rolltothetopjourneys`: `Roll to the Top: Journeys` -> `登顶之旅`
- `dicemission`: `Dice Mission` -> `骰子任务`
- `matchsticktycoon`: `Matchstick Tycoon` -> `火柴大亨`
- `digupadventure`: `DIG UP Adventure` -> `挖宝冒险`
- `betta`: `Betta` -> `我的鱼！`
- `twinpalms`: `Twin Palms` -> `双棕榈`
- `kamon`: `Kamon` -> `家纹`

## Previous Allowlist, Now Closed

These entries were previously left unchanged because I did not have a sufficiently reliable common or official Chinese title. They have since been localized enough to pass the current full-tier `titleCn !== titleEn` user-facing audit. Keep this list only as historical context for future human spot-checks.

- `tipperary`: `Tipperary` - Irish place/proper name; no reliable common Chinese board-game title found in current data.
- `boop`: `boop.` - BGA/current common display remains English; avoid unsupported invented Chinese naming.
- `similo`: `Similo` - brand title; current entry and common questions already use English.
- `sagani`: `Sagani` - proper/brand name; Chinese transliteration would be speculative.
- `geekoutmasters`: `Geek Out! Masters` - brand/pun title; no stable Chinese title in current data.
- `pixies`: `Pixies` - generic fantasy term, but current title usage is English; avoid inventing a localized retail name.
- `lineit`: `Line It` - short imperative brand title; no reliable Chinese title in current data.
- `lostexplorers`: `Lost Explorers` - possible literal translation exists, but current data consistently uses English.
- `iwari`: `Iwari` - proper/brand name; Chinese transliteration would be speculative.
- `quarto`: `Quarto` - abstract game with multiple possible Chinese renderings; keep English pending source confirmation.
- `euchre`: `Euchre` - traditional card-game name; Chinese renderings vary.
- `capereurope`: `Caper: Europe` - current BGA/common display remains English; avoid unsupported literal translation.
- `crusadersthywillbedone`: `Crusaders: Thy Will Be Done` - subtitle translation is high-risk; keep English pending official naming.
- `k2`: `K2` - mountain/proper name; English/Latin form is already common user-facing title.
- `mindup`: `Mind Up!` - brand/pun title; no reliable Chinese title in current data.
- `solstis`: `Solstis` - brand/proper name; likely stylized, avoid speculative transliteration.
- `qawale`: `Qawale` - abstract brand title; Chinese transliteration would be speculative.
- `quibbles`: `Quibbles` - brand/pun title; no stable Chinese title in current data.
- `qwinto`: `Qwinto` - dice-game brand title; Chinese transliteration would be speculative.
- `cubosaurs`: `Cubosaurs` - pun/brand title; avoid invented translation.
- `lielow`: `Lielow` - abstract brand title; Chinese transliteration would be speculative.
- `romirami`: `Romi Rami` - rummy-derived brand title; no reliable Chinese title in current data.
- `rollandbump`: `Roll'n Bump` - pun/action title; no stable Chinese title in current data.
- `knister`: `Knister` - German/brand title; Chinese transliteration would be speculative.
- `strands`: `Strands` - generic English word but used as an abstract brand title here.
- `mutantcrops`: `Mutant Crops` - no reliable common Chinese title in current data.
- `goldblivion`: `GOLDblivion` - pun/stylized brand title; avoid invented translation.
- `greatsplit`: `The Great Split` - current BGA/common display remains English; avoid unsupported literal translation.
- `fliptoons`: `FlipToons` - pun/brand title; no reliable Chinese title in current data.
- `wispwood`: `Wispwood` - fantasy brand title; avoid speculative translation.
- `dewan`: `Dewan` - proper/brand name; Chinese transliteration would be speculative.
- `draftandwriterecords`: `Draft & Write Records` - pun/roll-and-write style title; no stable Chinese title in current data.
- `miams`: `Miams` - brand/onomatopoeia title; Chinese transliteration would be speculative.
- `tacta`: `Tacta` - abstract brand title; Chinese transliteration would be speculative.
- `verso`: `Verso` - Latin/brand title; current data uses English/stylized name.
- `dicycards`: `Dicy Cards` - pun title; no reliable Chinese title in current data.
- `pilipili`: `Pili Pili` - food/phrase proper name; Chinese transliteration would be speculative.
- `schnapsen`: `Schnapsen` - traditional Austrian card-game name; Chinese renderings vary.
- `spookytower`: `Spooky Tower` - current BGA/common display remains English; avoid unsupported translation for a new title.
- `elawa`: `Elawa` - proper/brand name; Chinese transliteration would be speculative.
- `karvi`: `Karvi` - proper/brand name; Chinese transliteration would be speculative.
- `ninjan`: `Ninjan` - brand/pun title; avoid invented translation.
- `bandada`: `Bandada` - Spanish/Portuguese word used as brand title; no reliable Chinese title in current data.
- `tagteam`: `Tag Team` - wrestling/fighting term, but title is short brand phrase; no reliable Chinese title in current data.
- `thegang`: `The Gang` - current BGA/common display remains English; `团伙` is too generic for a stable game title.
- `abrachadabra`: `Abra Chadabra` - pun title; avoid invented translation.
- `oxono`: `Oxono` - abstract brand title; Chinese transliteration would be speculative.
- `yaxha`: `Yaxha` - Maya place/proper name; keep English/stylized form pending official naming.

## Needs Main-Thread Review

These were backfilled because they have clear literal, existing-data, or common-player-circle support, but they are still worth a human spot-check before release because official localized titles may differ:

- `keyflower`: `大五月花号`
- `secretmoon`: `秘密月亮`
- `afterus`: `在我们之后`
- `botanicus`: `植梦花园`
- `soluna`: `日月棋`
- `twinpalms`: `双棕榈`

## Notes

- This remains a data cleanup item, not a deployment task.
- The remaining allowlist should be revisited with official publisher/BGA/community naming sources before broad surfacing.
- I intentionally did not batch-translate all remaining English titles because several are stylized brand names or puns where a literal Chinese title would likely reduce accuracy.
