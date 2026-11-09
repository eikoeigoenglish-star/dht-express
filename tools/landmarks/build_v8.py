#!/usr/bin/env python3
"""
build_v8.py — 【v8】全国ランドマーク（東京・神奈川・千葉以外、北緯 37°40′23″ 以南）と灯台 13 件のデータを
data/landmarks-v8.json に書き出す。

  python3 tools/landmarks/build_v8.py

・1 行 = 1 件：(id, 名称, 都道府県, 緯度, 経度, kind（js/landmarks-japan.js のビルダー）, 大きさ L/M/S, p（パラメータ）, 向き°)
・座標は各施設の代表点の概略値（公開されている地図上の位置を手で読んだもの。数百 m 程度の誤差を含む）。
・既存（data/landmarks.json）と同じ施設は入れない（BUILD 時に id と名称で重複を確認）。
・灯台は kind=lighthouseV8 と "lighthouse"（灯火の情報）を持つ。犬吠埼は v6 の既存モデルに augment で灯火だけ足す。
"""
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NORTH = 37 + 40 / 60 + 23 / 3600

SIZE = {
    # showKm（モデル表示距離）, fullKm（完全形）, labelKm, nearKm, imp（ラベル重要度）
    'L': (140, 32, 90, 80, 0.78),
    'M': (85, 22, 55, 50, 0.6),
    'S': (50, 14, 32, 30, 0.45),
    'LH': (120, 26, 60, 55, 0.62),
}

W = '#f5f3ec'
BLACK = '#2b2b2e'
BRICK = '#b0482f'

# fmt: off
ROWS = [
    # ---- 新潟（弥彦神社・弥彦山・佐渡は北緯 37°40′23″ より北のため対象外）----
    ('nagaoka-aore', 'アオーレ長岡・長岡駅', '新潟', 37.4481, 138.8482, 'building', 'M', dict(w=110, d=60, h=22, wall='#8a6f50', accent='#c9b38a', lawn=0.2)),
    ('naeba', '苗場スキー場', '新潟', 36.7930, 138.7870, 'summit', 'M', dict(ropeway=True)),
    ('kiyotsukyo', '清津峡', '新潟', 36.9340, 138.7480, 'gorge', 'M', dict(L=0.4, h=0.09, cave=True)),
    # ---- 福島 ----
    ('tsurugajo', '鶴ヶ城', '福島', 37.4878, 139.9298, 'castle', 'L', dict(tiers=5, base=22, roof='#a8432e', moat=0.22)),
    ('shirakawa-komine', '白河小峰城', '福島', 37.1338, 140.2165, 'castle', 'M', dict(tiers=3, base=15, stoneH=12)),
    ('tenkyokaku', '猪苗代湖畔・天鏡閣', '福島', 37.5277, 140.0534, 'western', 'S', dict(type='villa')),
    ('bandaisan', '磐梯山', '福島', 37.6006, 140.0726, 'summit', 'L', dict()),
    ('ouchijuku', '大内宿', '福島', 37.3340, 139.8600, 'town', 'M', dict(style='thatch', n=22, linear=True, r=0.22, road=True)),
    # ---- 茨城 ----
    ('ushiku-daibutsu', '牛久大仏', '茨城', 35.9819, 140.2196, 'statue', 'L', dict(type='buddha', hM=120, s=0.0038)),
    ('kairakuen', '偕楽園', '茨城', 36.3725, 140.4552, 'garden', 'M', dict(plum=True, r=0.25, trees=26)),
    ('tsukubasan', '筑波山', '茨城', 36.2253, 140.1067, 'summit', 'L', dict(ropeway=True)),
    ('kashima-jingu', '鹿島神宮', '茨城', 35.9686, 140.6311, 'shrine', 'M', dict(forest=True, torii=30, size=1.1)),
    ('fukuroda-falls', '袋田の滝', '茨城', 36.7643, 140.4053, 'waterfall', 'M', dict(hM=120, wM=73, steps=4)),
    # ---- 栃木 ----
    ('nikko-toshogu', '日光東照宮', '栃木', 36.7580, 139.5988, 'shrine', 'L', dict(forest=True, pagoda=True, roof='#2f3a36', size=1.2)),
    ('kegon-falls', '華厳の滝', '栃木', 36.7381, 139.5022, 'waterfall', 'M', dict(hM=97, wM=7)),
    ('chugushi', '中禅寺湖畔・二荒山神社中宮祠', '栃木', 36.7440, 139.4975, 'shrine', 'S', dict(size=0.8)),
    ('utsunomiya-futarasan', '宇都宮二荒山神社', '栃木', 36.5602, 139.8848, 'shrine', 'S', dict(size=0.9)),
    ('ashikaga-gakko', '足利学校', '栃木', 36.3353, 139.4522, 'building', 'S', dict(w=30, d=18, h=8, wall='#6d5a44', roof='hip', roofColor='#8a7550')),
    # ---- 群馬 ----
    ('tomioka-silk-mill', '富岡製糸場', '群馬', 36.2554, 138.8878, 'building', 'M', dict(w=140, d=14, h=12, wall=BRICK, roof='gable', roofColor='#55606a', n=2, gap=0.12, excludeR=0.45)),
    ('kusatsu-yubatake', '草津温泉・湯畑', '群馬', 36.6227, 138.5961, 'town', 'M', dict(style='onsen', n=22, r=0.16)),
    ('haruna', '榛名山・榛名湖', '群馬', 36.4760, 138.8790, 'summit', 'M', dict(lake=0.18, lakeX=-0.6, lakeZ=0.15)),
    ('akagi', '赤城山', '群馬', 36.5600, 139.1933, 'summit', 'M', dict()),
    ('takasaki-kannon', '高崎白衣大観音', '群馬', 36.3135, 138.9796, 'statue', 'M', dict(type='kannon', hM=42, s=0.006)),
    # ---- 埼玉 ----
    ('kawagoe-tokinokane', '川越・時の鐘', '埼玉', 35.9236, 139.4848, 'pagoda', 'S', dict(tiers=3, base=5, tierH=5.5, wall='#3a3430')),
    ('kawagoe-kura', '川越・蔵造りの町並み', '埼玉', 35.9270, 139.4822, 'town', 'S', dict(style='kura', linear=True, n=20, r=0.18, road=True)),
    ('saitama-super-arena', 'さいたまスーパーアリーナ', '埼玉', 35.8949, 139.6311, 'building', 'M', dict(w=130, d=110, h=40, wall='#b7c3cc', accent='#5f7389', excludeR=0.36)),
    ('railway-museum', '鉄道博物館', '埼玉', 35.9216, 139.6178, 'building', 'S', dict(w=200, d=60, h=18, roof='arc', roofColor='#9aa4ad', wall='#d6d2c8', excludeR=0.52)),
    ('chichibu-jinja', '秩父神社', '埼玉', 35.9978, 139.0838, 'shrine', 'S', dict(size=0.9)),
    ('gaikaku-hosuiro', '首都圏外郭放水路', '埼玉', 35.9925, 139.7940, 'floodway', 'S', dict(excludeR=0.28)),
    # ---- 山梨 ----
    ('fujiq-highland', '富士急ハイランド', '山梨', 35.4870, 138.7800, 'themePark', 'M', dict()),
    ('takeda-jinja', '武田神社', '山梨', 35.6870, 138.5770, 'shrine', 'S', dict(size=0.9)),
    ('kofu-castle', '甲府城（舞鶴城公園）', '山梨', 35.6627, 138.5714, 'castleRuins', 'S', dict(L=0.3, levels=3)),
    ('shosenkyo', '昇仙峡', '山梨', 35.7370, 138.5760, 'gorge', 'M', dict(peak=True, L=0.5, h=0.07)),
    ('kawaguchiko-bridge', '河口湖大橋', '山梨', 35.5072, 138.7678, 'bridge', 'S', dict(
        path=[[35.5030, 138.7666, 'land'], [35.5048, 138.7672, 'water'], [35.5098, 138.7684, 'water'], [35.5115, 138.7690, 'land']],
        spans=[], deckColor='#d9dde0', deckW=0.04, deckT=0.02)),
    # ---- 長野 ----
    ('matsumoto-castle', '松本城', '長野', 36.2386, 137.9688, 'castle', 'L', dict(tiers=5, base=18, wall=BLACK, moat=0.18, yagura=1)),
    ('zenkoji', '善光寺', '長野', 36.6616, 138.1878, 'temple', 'M', dict(size=1.3, roof='#3f4a52')),
    ('suwa-taisha', '諏訪大社（上社本宮）', '長野', 35.9988, 138.1191, 'shrine', 'M', dict(plain=True, forest=True, size=1.1)),
    ('kamisuwa-onsen', '諏訪湖畔・上諏訪温泉（間欠泉）', '長野', 36.0445, 138.1110, 'town', 'S', dict(style='onsen', n=14, r=0.14)),
    ('kamikochi-kappabashi', '上高地・河童橋', '長野', 36.2510, 137.6380, 'smallBridge', 'M', dict(type='chinka', L=0.12, deg=30, color='#8a6f45')),
    ('karuizawa-station', '軽井沢駅', '長野', 36.3428, 138.6352, 'building', 'S', dict(w=70, d=24, h=12, wall='#e8e2d4', roof='gable', roofColor='#4a6b5c')),
    # ---- 静岡（富士山・浜名湖は既存の地形・水系を使う）----
    ('miho-matsubara', '三保松原', '静岡', 35.0003, 138.5225, 'beach', 'M', dict(L=1.4, W=0.12, deg=20, pines=40)),
    ('kunozan-toshogu', '久能山東照宮', '静岡', 34.9640, 138.4680, 'shrine', 'S', dict(size=0.9, forest=True)),
    ('hamamatsu-castle', '浜松城', '静岡', 34.7110, 137.7253, 'castle', 'M', dict(tiers=3, base=14)),
    ('bentenjima-torii', '浜名湖・弁天島の大鳥居', '静岡', 34.6830, 137.6070, 'bigTorii', 'M', dict(water=True, w=24)),
    ('atami-castle', '熱海城', '静岡', 35.0900, 139.0730, 'castle', 'S', dict(tiers=5, base=16)),
    # ---- 富山 ----
    ('toyama-castle', '富山城', '富山', 36.6930, 137.2100, 'castle', 'M', dict(tiers=3, base=14, moat=0.12)),
    ('tateyama', '立山（雄山）', '富山', 36.5755, 137.6195, 'summit', 'L', dict()),
    ('kurobe-dam', '黒部ダム', '富山', 36.5664, 137.6623, 'dam', 'M', dict()),
    ('amaharashi', '雨晴海岸', '富山', 36.8270, 137.0480, 'coastRock', 'S', dict(type='rocks')),
    ('shinminato-bridge', '新湊大橋', '富山', 36.7806, 137.1070, 'bridge', 'M', dict(
        path=[[36.7765, 137.1088, 'land'], [36.7782, 137.1080, 'anchor'], [36.7830, 137.1060, 'anchor'], [36.7848, 137.1052, 'land']],
        spans=[dict(type='stayed', **{'from': 1, 'to': 2}, towers=[0.25, 0.75], towerM=127, deckM=47)], deckColor='#eef0f2', deckW=0.05)),
    # ---- 石川 ----
    ('kanazawa-castle', '金沢城', '石川', 36.5650, 136.6590, 'castle', 'M', dict(tiers=3, base=18, roof='#c3c8c5', yagura=2)),
    ('kenrokuen', '兼六園', '石川', 36.5622, 136.6628, 'garden', 'M', dict(lantern=True, r=0.26, trees=26, hill=True)),
    ('kanazawa-station', '金沢駅・鼓門', '石川', 36.5780, 136.6480, 'tsuzumimon', 'M', dict()),
    ('chirihama', '千里浜なぎさドライブウェイ', '石川', 36.8820, 136.7700, 'beach', 'M', dict(L=2.4, W=0.1, deg=30, cars=True)),
    ('notojima-bridge', '能登島大橋', '石川', 37.0916, 136.9218, 'bridge', 'S', dict(
        path=[[37.0868, 136.9188, 'land'], [37.0890, 136.9200, 'water'], [37.0948, 136.9238, 'water'], [37.0965, 136.9248, 'land']],
        spans=[], deckColor='#dfe3e6', deckW=0.04)),
    # ---- 福井 ----
    ('dinosaur-museum', '福井県立恐竜博物館', '福井', 36.0820, 136.5070, 'eggDome', 'M', dict()),
    ('eiheiji', '永平寺', '福井', 36.0550, 136.3550, 'temple', 'M', dict(forest=True, size=1.2)),
    ('tojinbo', '東尋坊', '福井', 36.2380, 136.1250, 'coastRock', 'M', dict(type='pillars')),
    ('maruoka-castle', '丸岡城', '福井', 36.1520, 136.2720, 'castle', 'M', dict(tiers=2, base=14, stoneH=7, roof='#5b6066')),
    ('tsuruga-akarenga', '敦賀赤レンガ倉庫', '福井', 35.6610, 136.0700, 'building', 'S', dict(w=60, d=18, h=10, wall=BRICK, roof='gable', roofColor='#4a4f55', n=2, gap=0.06)),
    # ---- 岐阜 ----
    ('gifu-castle', '岐阜城', '岐阜', 35.4339, 136.7819, 'castle', 'M', dict(tiers=3, base=12, stoneH=5)),
    ('shirakawago', '白川郷', '岐阜', 36.2575, 136.9060, 'town', 'L', dict(style='gassho', n=20, r=0.2)),
    ('takayama-sanmachi', '高山・古い町並', '岐阜', 36.1402, 137.2620, 'town', 'M', dict(style='machiya', linear=True, n=24, r=0.2, road=True)),
    ('gujo-hachiman-castle', '郡上八幡城', '岐阜', 35.7480, 136.9600, 'castle', 'M', dict(tiers=4, base=12)),
    ('yoro-falls', '養老の滝', '岐阜', 35.2706, 136.5300, 'waterfall', 'S', dict(hM=32, wM=4)),
    # ---- 愛知（名古屋城・JR セントラルタワーズは既存）----
    ('inuyama-castle', '犬山城', '愛知', 35.3870, 136.9421, 'castle', 'M', dict(tiers=3, base=15)),
    ('atsuta-jingu', '熱田神宮', '愛知', 35.1283, 136.9087, 'shrine', 'M', dict(forest=True, plain=True, size=1.2, roof='#4a5a50')),
    ('nagoya-port-aquarium', '名古屋港水族館', '愛知', 35.0909, 136.8780, 'aquarium', 'M', dict(w=0.18)),
    ('toyota-stadium', '豊田スタジアム', '愛知', 35.0838, 137.1701, 'stadium', 'M', dict(arch=True, rx=0.13, rz=0.11, h=0.04)),
    ('centrair', '中部国際空港セントレア', '愛知', 34.8584, 136.8054, 'airport', 'L', dict(island=True, L=3.6, W=1.6, runways=1, terminal='#d3d8dc')),
    # ---- 三重 ----
    ('ise-jingu', '伊勢神宮（内宮）', '三重', 34.4550, 136.7250, 'iseJingu', 'L', dict()),
    ('meotoiwa', '夫婦岩', '三重', 34.5085, 136.7880, 'coastRock', 'M', dict(type='couple')),
    ('toba-aquarium', '鳥羽水族館', '三重', 34.4810, 136.8460, 'aquarium', 'S', dict(w=0.15)),
    ('shima-spain-mura', '志摩スペイン村', '三重', 34.3745, 136.8800, 'themePark', 'M', dict(type='spanish')),
    ('suzuka-circuit', '鈴鹿サーキット', '三重', 34.8431, 136.5410, 'circuit', 'M', dict()),
    # ---- 滋賀 ----
    ('hikone-castle', '彦根城', '滋賀', 35.2764, 136.2518, 'castle', 'L', dict(tiers=3, base=16)),
    ('enryakuji', '延暦寺（根本中堂）', '滋賀', 35.0700, 135.8410, 'temple', 'M', dict(forest=True, size=1.1, roof='#3f4a52')),
    ('biwako-bridge', '琵琶湖大橋', '滋賀', 35.0868, 135.9345, 'bridge', 'M', dict(
        path=[[35.0812, 135.9238, 'land'], [35.0830, 135.9270, 'water'], [35.0905, 135.9420, 'water'], [35.0925, 135.9452, 'land']],
        spans=[], deckColor='#e6e9eb', deckW=0.05)),
    ('omihachiman-suigo', '近江八幡の水郷', '滋賀', 35.1400, 136.0870, 'town', 'S', dict(style='canal', n=18, r=0.18)),
    ('azuchi-castle', '安土城跡', '滋賀', 35.1555, 136.1394, 'castleRuins', 'M', dict(levels=4, stairs=True)),
    # ---- 京都（京都タワー・金閣寺は既存）----
    ('kiyomizudera', '清水寺', '京都', 34.9949, 135.7850, 'kiyomizu', 'L', dict(), 260),
    ('fushimi-inari', '伏見稲荷大社', '京都', 34.9671, 135.7727, 'fushimiInari', 'L', dict(excludeR=0.4), 270),
    ('byodoin', '平等院鳳凰堂', '京都', 34.8893, 135.8077, 'byodoin', 'M', dict(), 270),
    ('toji', '東寺五重塔', '京都', 34.9806, 135.7478, 'pagoda', 'L', dict(tiers=5, base=10, tierH=7.5, hall=True, excludeR=0.19)),
    ('amanohashidate', '天橋立', '京都', 35.5705, 135.1940, 'beach', 'L', dict(L=3.4, W=0.16, deg=21, pines=70, spit=True)),
    # ---- 大阪（天保山大観覧車・大仙陵古墳は既存）----
    ('osaka-castle', '大阪城', '大阪', 34.6873, 135.5262, 'castle', 'L', dict(tiers=5, base=24, roof='#5c9a86', gold=True, moat=0.35)),
    ('tsutenkaku', '通天閣', '大阪', 34.6525, 135.5063, 'tower', 'M', dict(type='lattice', hM=103, s=0.0035, color='#9aa1a6', cab='#e9d58a')),
    ('abeno-harukas', 'あべのハルカス', '大阪', 34.6459, 135.5136, 'tower', 'L', dict(type='slab', hM=300, s=0.0032)),
    ('taiyo-no-to', '太陽の塔', '大阪', 34.8094, 135.5323, 'sunTower', 'M', dict()),
    ('kansai-airport', '関西国際空港', '大阪', 34.4347, 135.2440, 'airport', 'L', dict(island=True, L=4.2, W=1.3, runways=2, terminal='#c9ced3'), 51),
    # ---- 兵庫（姫路城・明石海峡大橋は既存。鳴門海峡の橋梁景観は大鳴門橋（徳島）と共通）----
    ('kobe-port-tower', '神戸ポートタワー', '兵庫', 34.6826, 135.1866, 'tower', 'M', dict(type='hyper', hM=108, s=0.004, color='#c8332b')),
    ('nankinmachi', '南京町', '兵庫', 34.6880, 135.1880, 'town', 'S', dict(style='chinatown', n=16, r=0.1, linear=True), 90),
    ('rokkosan', '六甲山', '兵庫', 34.7779, 135.2634, 'summit', 'M', dict(antenna=True)),
    ('takeda-castle', '竹田城跡', '兵庫', 35.3003, 134.8289, 'castleRuins', 'M', dict(levels=3, L=0.4)),
    # ---- 奈良 ----
    ('todaiji', '東大寺大仏殿', '奈良', 34.6890, 135.8398, 'daibutsuden', 'L', dict()),
    ('kasuga-taisha', '春日大社', '奈良', 34.6814, 135.8484, 'shrine', 'M', dict(forest=True)),
    ('kofukuji', '興福寺五重塔', '奈良', 34.6830, 135.8318, 'pagoda', 'M', dict(tiers=5, base=9, tierH=7, hall=True, excludeR=0.19)),
    ('horyuji', '法隆寺', '奈良', 34.6147, 135.7342, 'temple', 'L', dict(pagoda=1, size=1.1, wall='#a9744b')),
    ('heijo-palace', '平城宮跡', '奈良', 34.6910, 135.7960, 'heijo', 'M', dict()),
    # ---- 和歌山 ----
    ('wakayama-castle', '和歌山城', '和歌山', 34.2240, 135.1725, 'castle', 'M', dict(tiers=3, base=14)),
    ('koyasan-daito', '高野山・根本大塔', '和歌山', 34.2133, 135.5833, 'pagoda', 'M', dict(tiers=2, base=16, tierH=12, wall='#d24a2c')),
    ('nachi-falls', '那智の滝', '和歌山', 33.6753, 135.8885, 'waterfall', 'L', dict(hM=133, wM=13)),
    ('seigantoji', '青岸渡寺（三重塔）', '和歌山', 33.6687, 135.8897, 'pagoda', 'M', dict(tiers=3, base=9, wall='#d24a2c', trees=True, excludeR=0.17)),
    ('shionomisaki-cape', '潮岬（本州最南端）', '和歌山', 33.4420, 135.7570, 'grassCape', 'S', dict(horses=0, monument=True)),
    ('engetsuto', '白浜・円月島', '和歌山', 33.6930, 135.3355, 'coastRock', 'M', dict(type='arch')),
    # ---- 鳥取 ----
    ('tottori-sakyu', '鳥取砂丘', '鳥取', 35.5420, 134.2290, 'beach', 'L', dict(dune=True, L=2.4, W=0.9, deg=80)),
    ('sand-museum', '砂の美術館', '鳥取', 35.5370, 134.2400, 'building', 'S', dict(w=60, d=40, h=10, wall='#d8cfb8')),
    ('nageiredo', '三徳山投入堂', '鳥取', 35.4000, 133.9600, 'cliffHall', 'M', dict(size=0.8)),
    ('daisen', '大山', '鳥取', 35.3712, 133.5463, 'summit', 'L', dict()),
    ('sakaiminato', '境港・水木しげるロード（街区）', '鳥取', 35.5440, 133.2330, 'town', 'S', dict(style='street', linear=True, n=22, r=0.2, road=True)),
    # ---- 島根（日御碕灯台は灯台カテゴリ）----
    ('izumo-taisha', '出雲大社', '島根', 35.4020, 132.6855, 'izumoTaisha', 'L', dict()),
    ('matsue-castle', '松江城', '島根', 35.4750, 133.0507, 'castle', 'L', dict(tiers=4, wall=BLACK, moat=0.2)),
    ('iwami-ginzan', '石見銀山', '島根', 35.1100, 132.4370, 'town', 'M', dict(style='mining', n=14, r=0.15, linear=True)),
    ('shinjiko-yomegashima', '宍道湖・嫁ヶ島', '島根', 35.4600, 133.0430, 'bigTorii', 'S', dict(water=True, w=8, island=True, color='#7d7a73')),
    ('adachi-museum', '足立美術館（庭園）', '島根', 35.3790, 133.1940, 'garden', 'M', dict(r=0.22, hill=True, trees=24)),
    # ---- 岡山（吉備津神社・瀬戸大橋は既存）----
    ('okayama-castle', '岡山城', '岡山', 34.6654, 133.9358, 'castle', 'L', dict(tiers=4, wall=BLACK, gold=True)),
    ('korakuen', '後楽園', '岡山', 34.6690, 133.9370, 'garden', 'M', dict(r=0.26, hill=True, trees=26)),
    ('kurashiki-bikan', '倉敷美観地区', '岡山', 34.5955, 133.7710, 'town', 'M', dict(style='canal', n=20, r=0.16)),
    ('bitchu-matsuyama-castle', '備中松山城', '岡山', 34.8090, 133.6220, 'castle', 'M', dict(tiers=2, base=12, stoneH=8)),
    # ---- 広島（厳島神社は既存。しまなみ海道は多々羅大橋・来島海峡大橋で表現）----
    ('genbaku-dome', '原爆ドーム', '広島', 34.3955, 132.4536, 'genbakuDome', 'L', dict()),
    ('hiroshima-castle', '広島城', '広島', 34.4027, 132.4594, 'castle', 'L', dict(tiers=5, base=16, wall='#3a3634', moat=0.25)),
    ('onomichi-senkoji', '尾道・千光寺', '広島', 34.4110, 133.2010, 'temple', 'M', dict(red=True, size=0.8)),
    ('tatara-bridge', '多々羅大橋（しまなみ海道）', '広島・愛媛', 34.2817, 133.0906, 'bridge', 'L', dict(
        path=[[34.2905, 133.0868, 'land'], [34.2880, 133.0880, 'anchor'], [34.2752, 133.0932, 'anchor'], [34.2728, 133.0946, 'land']],
        spans=[dict(type='stayed', **{'from': 1, 'to': 2}, towers=[0.2, 0.8], towerM=220, deckM=50)], deckColor='#e8ebee', connects=['生口島', '大三島'])),
    # ---- 山口（関門橋は既存。角島灯台は灯台カテゴリ）----
    ('kintaikyo', '錦帯橋', '山口', 34.1675, 132.1781, 'smallBridge', 'M', dict(type='kintai', L=0.2, deg=80)),
    ('rurikoji', '瑠璃光寺五重塔', '山口', 34.1915, 131.4740, 'pagoda', 'M', dict(tiers=5, base=8, wall='#6b5a46', roof='#5b4536')),
    ('tsunoshima-bridge', '角島大橋', '山口', 34.3478, 130.8768, 'bridge', 'M', dict(
        path=[[34.3443, 130.8835, 'land'], [34.3458, 130.8810, 'water'], [34.3500, 130.8725, 'water'], [34.3512, 130.8702, 'land']],
        spans=[], deckColor='#eef0f0', deckW=0.05, connects=['本州（下関市豊北町）', '角島'])),
    ('akiyoshidai', '秋吉台', '山口', 34.2400, 131.3060, 'karst', 'L', dict()),
    ('akiyoshido', '秋芳洞', '山口', 34.2280, 131.3030, 'gorge', 'S', dict(cave=True, L=0.25, h=0.05)),
    ('hagi-jokamachi', '萩城下町', '山口', 34.4110, 131.3960, 'town', 'M', dict(style='samurai', n=16, r=0.18)),
    # ---- 徳島 ----
    ('onaruto-bridge', '大鳴門橋', '徳島・兵庫', 34.2372, 134.6515, 'bridge', 'L', dict(
        path=[[34.2335, 134.6415, 'land'], [34.2352, 134.6458, 'anchor'], [34.2392, 134.6578, 'anchor'], [34.2408, 134.6612, 'land']],
        spans=[dict(type='suspension', **{'from': 1, 'to': 2}, towers=[0.12, 0.88], towerM=144, deckM=41)], connects=['鳴門市（大毛島）', '淡路島（南あわじ市）'])),
    ('naruto-uzushio', '鳴門の渦潮', '徳島', 34.2398, 134.6535, 'whirlpool', 'M', dict()),
    ('awaodori-kaikan', '阿波おどり会館', '徳島', 34.0700, 134.5430, 'building', 'S', dict(w=40, d=30, h=20, wall='#d9d2c3', accent='#c43b2b')),
    ('bizan', '眉山', '徳島', 34.0620, 134.5300, 'summit', 'M', dict(antenna=True, ropeway=True)),
    ('iya-kazurabashi', '祖谷のかずら橋', '徳島', 33.8800, 133.8340, 'smallBridge', 'M', dict(type='vine', L=0.1, deg=90)),
    # ---- 香川 ----
    ('takamatsu-castle', '高松城（玉藻城）', '香川', 34.3503, 134.0526, 'castle', 'M', dict(tiers=2, base=14, moat=0.2)),
    ('ritsurin', '栗林公園', '香川', 34.3300, 134.0450, 'garden', 'M', dict(r=0.28, hill=True, trees=30)),
    ('kotohiragu', '金刀比羅宮', '香川', 34.1840, 133.8090, 'shrine', 'M', dict(forest=True)),
    ('marugame-castle', '丸亀城', '香川', 34.2860, 133.8000, 'castle', 'M', dict(tiers=3, base=10, stoneH=22)),
    ('seto-ohashi-tower', '瀬戸大橋記念公園・瀬戸大橋タワー', '香川', 34.3420, 133.8200, 'tower', 'S', dict(type='obs', hM=108, cab='#9fb6ca')),
    # ---- 愛媛 ----
    ('matsuyama-castle', '松山城', '愛媛', 33.8456, 132.7655, 'castle', 'L', dict(tiers=3, base=16)),
    ('dogo-onsen', '道後温泉本館', '愛媛', 33.8520, 132.7863, 'dogoOnsen', 'M', dict()),
    ('imabari-castle', '今治城', '愛媛', 34.0644, 133.0040, 'castle', 'M', dict(tiers=5, base=14, moat=0.25)),
    ('kurushima-bridge', '来島海峡大橋', '愛媛', 34.1400, 132.9970, 'bridge', 'L', dict(
        path=[[34.1172, 132.9908, 'land'], [34.1215, 132.9925, 'anchor'], [34.1330, 132.9950, 'anchor'], [34.1395, 132.9968, 'land'],
              [34.1450, 132.9985, 'anchor'], [34.1590, 133.0035, 'anchor'], [34.1625, 133.0050, 'land']],
        spans=[dict(type='suspension', **{'from': 1, 'to': 2}, towers=[0.15, 0.85], towerM=149, deckM=65),
               dict(type='suspension', **{'from': 4, 'to': 5}, towers=[0.1, 0.9], towerM=184, deckM=65)], connects=['今治市（糸山）', '大島'])),
    ('uwajima-castle', '宇和島城', '愛媛', 33.2196, 132.5650, 'castle', 'M', dict(tiers=3, base=12)),
    # ---- 高知（室戸岬灯台・足摺岬灯台は灯台カテゴリ）----
    ('kochi-castle', '高知城', '高知', 33.5606, 133.5313, 'castle', 'L', dict(tiers=4, base=15)),
    ('katsurahama', '桂浜', '高知', 33.4960, 133.5760, 'beach', 'M', dict(L=0.8, W=0.08, deg=100, pines=10)),
    ('ryoma-statue', '坂本龍馬像', '高知', 33.4985, 133.5740, 'statue', 'M', dict(type='figure', hM=13.5, ped=0.55, s=0.008)),
    ('harimayabashi', 'はりまや橋', '高知', 33.5602, 133.5428, 'smallBridge', 'S', dict(type='small', L=0.05, deg=0)),
    ('shimanto-chinkabashi', '四万十川・佐田沈下橋', '高知', 33.0230, 132.9040, 'smallBridge', 'M', dict(type='chinka', L=0.3, deg=100)),
    ('muroto-nakaoka', '室戸岬・中岡慎太郎像', '高知', 33.2480, 134.1790, 'statue', 'S', dict(type='figure', hM=6, ped=0.4, s=0.009)),
    # ---- 福岡（福岡タワーは既存）----
    ('dazaifu-tenmangu', '太宰府天満宮', '福岡', 33.5215, 130.5350, 'shrine', 'L', dict(size=1.1, forest=True, roof='#4a6b5c')),
    ('paypay-dome', '福岡PayPayドーム', '福岡', 33.5954, 130.3621, 'stadium', 'L', dict(dome=True, rx=0.13, rz=0.13, domeH=0.07, domeColor='#c9ced3')),
    ('mojiko-station', '門司港駅', '福岡', 33.9467, 130.9614, 'building', 'M', dict(w=50, d=18, h=12, wall='#e6d6b8', roof='mansard', roofColor='#3e4a54')),
    ('uminonakamichi', '海の中道', '福岡', 33.6600, 130.3700, 'beach', 'L', dict(spit=True, L=6.0, W=0.4, deg=60, pines=50)),
    ('munakata-taisha', '宗像大社', '福岡', 33.8310, 130.5140, 'shrine', 'M', dict(plain=True, forest=True)),
    # ---- 佐賀 ----
    ('yoshinogari', '吉野ヶ里遺跡', '佐賀', 33.3268, 130.3850, 'yoshinogari', 'L', dict()),
    ('karatsu-castle', '唐津城', '佐賀', 33.4555, 129.9745, 'castle', 'M', dict(tiers=5, base=14)),
    ('yutoku-inari', '祐徳稲荷神社', '佐賀', 33.1400, 130.1500, 'cliffHall', 'M', dict(red=True, size=1.4)),
    ('niji-no-matsubara', '虹の松原', '佐賀', 33.4440, 130.0050, 'beach', 'L', dict(L=4.5, W=0.5, deg=60, pines=80)),
    ('saga-balloon', '佐賀バルーンフェスタ（嘉瀬川河川敷）', '佐賀', 33.2370, 130.2650, 'balloons', 'M', dict()),
    # ---- 長崎 ----
    ('glover-garden', 'グラバー園', '長崎', 32.7335, 129.8685, 'western', 'M', dict(type='villa')),
    ('oura-church', '大浦天主堂', '長崎', 32.7347, 129.8710, 'western', 'M', dict(type='church')),
    ('peace-statue', '平和祈念像', '長崎', 32.7765, 129.8635, 'statue', 'M', dict(type='seated', hM=9.7, s=0.012, ped=0.45)),
    ('inasayama', '稲佐山', '長崎', 32.7550, 129.8510, 'summit', 'M', dict(antenna=True)),
    ('gunkanjima', '軍艦島（端島）', '長崎', 32.6276, 129.7386, 'gunkanjima', 'L', dict()),
    ('huis-ten-bosch', 'ハウステンボス（欧風の街区）', '長崎', 33.0860, 129.7880, 'town', 'L', dict(style='euro', tower=True, windmill=True, n=22, r=0.22)),
    # ---- 熊本（熊本城は既存）----
    ('aso-nakadake', '阿蘇・中岳火口', '熊本', 32.8840, 131.1040, 'summit', 'L', dict(crater=True)),
    ('tsujunkyo', '通潤橋', '熊本', 32.6650, 130.9600, 'smallBridge', 'M', dict(type='stoneArch', L=0.12, deg=90, spray=True)),
    ('suizenji', '水前寺成趣園', '熊本', 32.7910, 130.7330, 'garden', 'M', dict(r=0.18, hill=True)),
    ('amakusa-gokyo', '天草五橋（天門橋）', '熊本', 32.6170, 130.4418, 'bridge', 'M', dict(
        path=[[32.6200, 130.4470, 'land'], [32.6185, 130.4440, 'water'], [32.6150, 130.4385, 'water'], [32.6140, 130.4365, 'land']],
        spans=[dict(type='truss', **{'from': 1, 'to': 2}, deckM=40)], connects=['宇城市三角町', '大矢野島'])),
    # ---- 大分 ----
    ('beppu-yukemuri', '別府の湯けむり（鉄輪）', '大分', 33.3170, 131.4770, 'town', 'L', dict(style='onsen', n=24, r=0.25, plumes=10)),
    ('usa-jingu', '宇佐神宮', '大分', 33.5260, 131.3740, 'shrine', 'M', dict(size=1.1, forest=True)),
    ('yufudake', '由布岳', '大分', 33.2820, 131.3900, 'summit', 'L', dict()),
    ('kokonoe-yume-bridge', '九重“夢”大吊橋', '大分', 33.1590, 131.2200, 'smallBridge', 'M', dict(type='skyway', L=0.39, deg=20, excludeR=0.21)),
    ('oita-stadium', '大分スポーツ公園総合競技場', '大分', 33.2000, 131.6560, 'stadium', 'M', dict(dome=True, rx=0.15, rz=0.13, domeH=0.06, domeColor='#d9dde0')),
    # ---- 宮崎（都井岬灯台は灯台カテゴリ）----
    ('aoshima-jinja', '青島神社', '宮崎', 31.8050, 131.4740, 'coastRock', 'M', dict(type='island')),
    ('oni-no-sentakuita', '鬼の洗濯板', '宮崎', 31.8000, 131.4720, 'coastRock', 'S', dict(type='washboard')),
    ('takachiho-kyo', '高千穂峡', '宮崎', 32.7020, 131.3010, 'gorge', 'M', dict(fall=True, boat=True, L=0.35, h=0.08)),
    ('udo-jingu', '鵜戸神宮', '宮崎', 31.6510, 131.4625, 'shrine', 'M', dict(size=0.8)),
    ('sunmesse-nichinan', 'サンメッセ日南（石像の並ぶ丘）', '宮崎', 31.6600, 131.4630, 'statue', 'M', dict(type='moai', n=7)),
    ('toimisaki', '都井岬（御崎馬）', '宮崎', 31.3710, 131.3330, 'grassCape', 'M', dict()),
    # ---- 鹿児島（桜島は既存の地形と地名。屋久島は島名ラベル + 縄文杉で表現）----
    ('sengan-en', '仙巌園', '鹿児島', 31.6170, 130.5770, 'garden', 'M', dict(r=0.22, trees=20)),
    ('kirishima-jingu', '霧島神宮', '鹿児島', 31.8590, 130.8710, 'shrine', 'M', dict(size=1.2, forest=True)),
    ('chiran-bukeyashiki', '知覧武家屋敷', '鹿児島', 31.3780, 130.4460, 'town', 'M', dict(style='samurai', n=16, r=0.16, linear=True)),
    ('kaimondake', '開聞岳', '鹿児島', 31.1803, 130.5283, 'summit', 'L', dict()),
    ('jomonsugi', '屋久島・縄文杉', '鹿児島', 30.3600, 130.5300, 'bigTree', 'L', dict()),
    # ---- 沖縄（那覇・沖縄本島・宮古・石垣の地形は既存）----
    ('shurijo', '首里城', '沖縄', 26.2170, 127.7195, 'shuri', 'L', dict(), 270),
    ('shureimon', '守礼門', '沖縄', 26.2185, 127.7165, 'shureimon', 'M', dict(), 270),
    ('churaumi-aquarium', '沖縄美ら海水族館', '沖縄', 26.6943, 127.8779, 'aquarium', 'L', dict(w=0.2, dolphin=True, roof='#e8eef2')),
    ('manzamo', '万座毛', '沖縄', 26.5040, 127.8545, 'coastRock', 'M', dict(type='cape')),
    ('kouri-bridge', '古宇利大橋', '沖縄', 26.6968, 127.9929, 'bridge', 'L', dict(
        path=[[26.6880, 127.9940, 'land'], [26.6905, 127.9938, 'water'], [26.7035, 127.9920, 'water'], [26.7055, 127.9918, 'land']],
        spans=[], deckColor='#eef0f0', deckW=0.05, connects=['屋我地島', '古宇利島'])),
    ('okinawa-peace-park', '平和祈念公園（糸満）', '沖縄', 26.0950, 127.7260, 'peaceParkOkinawa', 'M', dict(), 180),
    ('sefa-utaki', '斎場御嶽', '沖縄', 26.1715, 127.8240, 'sefaUtaki', 'M', dict()),
    ('irabu-bridge', '伊良部大橋（宮古島）', '沖縄', 24.8070, 125.2415, 'bridge', 'L', dict(
        path=[[24.7960, 125.2650, 'land'], [24.7990, 125.2580, 'water'], [24.8150, 125.2240, 'water'], [24.8180, 125.2180, 'land']],
        spans=[], deckColor='#eef0f0', deckW=0.05, connects=['宮古島', '伊良部島'])),
    ('kabira-bay', '川平湾（石垣島）', '沖縄', 24.4570, 124.1440, 'kabira', 'M', dict()),
]

# 灯台 13 件（犬吠埼は v6 の既存モデル。灯火だけ augment で足す）。高さ hKm は実物の約 5 倍（日御碕は日本一高い石造灯台）
LIGHTHOUSES = [
    ('nojimazaki-lighthouse', '野島埼灯台', '千葉', 34.9020, 139.8880, dict(hKm=0.14, stout=True)),
    ('kannonzaki-lighthouse', '観音埼灯台', '神奈川', 35.2563, 139.7449, dict(hKm=0.1)),
    ('jogashima-lighthouse', '城ヶ島灯台', '神奈川', 35.1348, 139.6110, dict(hKm=0.075)),
    ('mikomotojima-lighthouse', '神子元島灯台', '静岡', 34.5706, 138.9439, dict(hKm=0.12, band='#2b2b2e')),
    ('omaezaki-lighthouse', '御前埼灯台', '静岡', 34.5960, 138.2260, dict(hKm=0.11)),
    ('shionomisaki-lighthouse', '潮岬灯台', '和歌山', 33.4352, 135.7540, dict(hKm=0.11)),
    ('kyogamisaki-lighthouse', '経ヶ岬灯台', '京都', 35.7790, 135.2240, dict(hKm=0.08)),
    ('izumo-hinomisaki-lighthouse', '出雲日御碕灯台', '島根', 35.4334, 132.6300, dict(hKm=0.21)),
    ('tsunoshima-lighthouse', '角島灯台', '山口', 34.3536, 130.8460, dict(hKm=0.15, color='#c9c4ba')),
    ('murotomisaki-lighthouse', '室戸岬灯台', '高知', 33.2445, 134.1776, dict(hKm=0.09)),
    ('ashizurimisaki-lighthouse', '足摺岬灯台', '高知', 32.7248, 133.0189, dict(hKm=0.1)),
    ('toimisaki-lighthouse', '都井岬灯台', '宮崎', 31.3657, 131.3449, dict(hKm=0.09)),
]
# fmt: on

EXCLUDED_NOTE = {
    '弥彦神社': '北緯 37.704°（北限 37.673° より北）',
    '弥彦山': '北緯 37.70°（北限より北）',
    '佐渡島': '島の南端（小木）でも北緯 37.8°（北限より北）',
}


def main():
    base = json.load(open(os.path.join(ROOT, 'data', 'landmarks.json'), encoding='utf-8'))
    existing_ids = {l['id'] for l in base['landmarks']}
    existing_names = {l['name'] for l in base['landmarks']}
    out = []
    seen = set()
    for r in ROWS:
        lid, name, pref, lat, lon, kind, size, p = r[:8]
        heading = r[8] if len(r) > 8 else 0
        assert lat < NORTH, (lid, lat)
        assert lid not in existing_ids and name not in existing_names and lid not in seen, f'duplicate: {lid} {name}'
        assert pref.split('・')[0] not in ('東京', '神奈川', '千葉'), lid
        seen.add(lid)
        show, full, label, near, imp = SIZE[size]
        e = dict(id=lid, name=name, kind=kind, lat=lat, lon=lon, region=pref, pref=pref, tier=1 if size == 'L' else 2, group='japan-v8',
                 showKm=show, fullKm=full, labelKm=label, nearKm=near, imp=imp, size=size)
        if heading:
            e['heading'] = heading
        if kind == 'bridge':
            e['path'] = p['path']
            e['spans'] = p.get('spans', [])
            for k in ('deckColor', 'deckW', 'deckT', 'connects'):
                if k in p:
                    e[k] = p[k]
            e['extentKm'] = 0
        else:
            e['p'] = p
            if 'excludeR' in p:
                e['excludeR'] = p['excludeR']
            if kind in ('airport', 'beach', 'karst', 'circuit', 'heijo'):
                e['extentKm'] = max(1.0, (p.get('L', 1.0) if kind != 'karst' else 0.6) * 0.6)
        out.append(e)
    for lid, name, pref, lat, lon, p in LIGHTHOUSES:
        assert lid not in existing_ids and lid not in seen, lid
        seen.add(lid)
        show, full, label, near, imp = SIZE['LH']
        out.append(dict(id=lid, name=name, kind='lighthouseV8', lat=lat, lon=lon, region=pref, pref=pref, tier=2, group='japan-v8',
                        showKm=show, fullKm=full, labelKm=label, nearKm=near, imp=imp, size='LH', category='lighthouse', p=p,
                        lighthouse=dict(heightKm=p['hKm'] * 1.3, periodSec=10 + (len(out) % 5) * 2)))
    data = {
        '_comment': 'v8: 全国ランドマーク（東京・神奈川・千葉以外、北緯37°40′23″以南）と灯台13件。tools/landmarks/build_v8.py が生成。モデルは js/landmarks-japan.js。',
        'fields': 'landmarks.json と同じ + p（ビルダーのパラメータ）, pref（都道府県）, size（L/M/S/LH）, category, lighthouse { heightKm, periodSec }',
        'excluded': EXCLUDED_NOTE,
        'augment': {'inubosaki-lighthouse': {'lighthouse': {'heightKm': 0.2, 'periodSec': 15, 'lampY': 0.165}, 'category': 'lighthouse'}},
        'landmarks': out,
    }
    path = os.path.join(ROOT, 'data', 'landmarks-v8.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    n_lh = sum(1 for e in out if e['kind'] == 'lighthouseV8') + 1
    print(f'wrote {path}: {len(out)} entries ({len(out) - (n_lh - 1)} landmarks + {n_lh - 1} lighthouses; 犬吠埼は既存モデルに augment で灯火を追加 → 灯台 {n_lh} 件)')
    by = {}
    for e in out:
        by.setdefault(e['pref'], 0)
        by[e['pref']] += 1
    print(by)


if __name__ == '__main__':
    sys.exit(main())
