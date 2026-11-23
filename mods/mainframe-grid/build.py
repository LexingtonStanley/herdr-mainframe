#!/usr/bin/env python3
"""Mainframe cast: original pixel-art cyberpunk characters, built from parts.

Run:  python3 build.py              (writes chars/<id>.svg, chars/<id>-face.svg and roster.js,
                                    and copies cast.js + roster.js to the mods that use them)
      python3 build.py --sheet f.png  (also a PNG contact sheet to look at, needs Pillow)

A character is a head + a body + colours. Heads are 12 rows, bodies 10, both 14 wide.
Letters name colours (see LEGEND); '.' is empty. A dark outline is added around the
silhouette. To add a character: add a line to CAST (and a head or body if you want a
new shape), run this script again. Order matters: agents take the next free one.
"""
import os, sys, json

W, HEAD_H, BODY_H = 14, 12, 10
H = 1 + HEAD_H + BODY_H + 1          # one row of room above and below for the outline
FACE = 14                            # the face picture: the top 14 rows
# The other mods that get a copy of cast.js and roster.js, and the line that marks a cast.js as ours.
COPIES = ["mainframe-side", "mainframe-tabs"]
MARK = 'export const KEY = "mainframe.cast";'

HEADS = {
 "slick": """
..............
..............
....HHHHHH....
...HHHHHHHH...
..HHHHHHHHHH..
..HHhSSSSSHH..
..HSSSSSSSSH..
..SSESSSSESS..
..SSESSSSESS..
..SSSSSSSSSS..
...SSSssSSS...
....SSSSSS....""",
 "mohawk": """
......GG......
.....GGGG.....
.....GGGG.....
....sGGGGs....
...ssGGGGss...
..sSSSggSSSs..
..SSSSSSSSSS..
..SSESSSSESS..
..SSESSSSESS..
..SSSSSSSSSS..
...SSSssSSS...
....SSSSSS....""",
 "hood": """
..............
.....JJJJ.....
...JJJJJJJJ...
..JJJJJJJJJJ..
.JJJjjjjjjJJJ.
.JJjDDDDDDjJJ.
.JJDDDDDDDDJJ.
.JJDGDDDDGDJJ.
.JJDGDDDDGDJJ.
.JJDDDDDDDDJJ.
.JJjDDDDDDjJJ.
..JJjjjjjjJJ..""",
 "visor": """
..............
..............
....HHHHHH....
...HHHHHHHH...
..HHHHHHHHHH..
..HHSSSSSSHH..
..SSSSSSSSSS..
.gGGGGGGGGGGg.
.gGLLGGGGGGGg.
..SSSSSSSSSS..
...SSSssSSS...
....SSSSSS....""",
 "android": """
.......G......
.......M......
....MMMMMM....
...MMMMMMMM...
..MMMMMMMMMM..
..MmmmmmmmmM..
..MDDDDDDDDM..
..MDGGDDGGDM..
..MDDDDDDDDM..
..MMMMMMMMMM..
...MmMmmMmM...
....MMMMMM....""",
 "catears": """
..............
..HH......HH..
..HGH....HGH..
..HHHHHHHHHH..
..HHHHHHHHHH..
..HHhSSSShHH..
..HSSSSSSSSH..
..HSESSSSESH..
..HSESSSSESH..
..HSSSSSSSSH..
..HHSSssSSHH..
..HH.SSSS.HH..""",
 "longhair": """
..............
..............
....HHHHHH....
...HHHHHHHH...
..HHHHHHHHHH..
..HHHHHhSSHH..
..HHhSSSSSSH..
..HSESSSSESH..
..HSESSSSESH..
..HSSSSSSSSH..
..HHSSssSSHH..
..HHHSSSSHHH..""",
 "helmet": """
..............
....CCCCCC....
...CCCCCCCC...
..CCCGGCCCCC..
..CCCGGCCCCC..
..CDDDDDDDDC..
..DDDDDDDDDD..
..DDLLDDDDDD..
..DDLDDDDDDD..
..CDDDDDDDDC..
..CCCCCCCCCC..
...CCccccCC...""",
 "spiky": """
...H..HH..H...
..HHH.HH.HHH..
..HHHHHHHHHH..
..HHHHHHHHHH..
..DGGDDDDGGD..
..HSSSSSSSSH..
..SSSSSSSSSS..
..SSESSSSESS..
..SSESSSSESS..
..SSSSSSSSSS..
...SSSssSSS...
....SSSSSS....""",
 "cap": """
..............
....CCCCCC....
...CCCCCCCC...
..CCCCGGCCCC..
.CCCCCCCCCCCC.
..cccccccccc..
..SSSSSSSSSS..
..SSESSSSESS..
..SDDDDDDDDS..
..DDDmDDmDDD..
...DDDDDDDD...
....DDDDDD....""",
 "bob": """
..............
..............
....HHHHHH....
...HHHHHHHH...
..HHHHHHHHHH..
..HHHHHHHHHH..
..HHhhhhhhHH..
..HSESSSSGSH..
..HSESSSSGSH..
..HSSSSSSSSH..
..HHSSssSSHH..
...HHSSSSHH...""",
 "buns": """
..HH......HH..
.HHHH....HHHH.
..GHHHHHHHHG..
...HHHHHHHH...
..HHHHHHHHHH..
..HHhSSSShHH..
..HSSSSSSSSH..
..SSESSSSESS..
..SSESSSSESS..
..SSSSSSSSSS..
...SSSssSSS...
....SSSSSS....""",
 "gasmask": """
..............
..............
....HHHHHH....
...HHHHHHHH...
..HHHHHHHHHH..
..DDDDDDDDDD..
..DGGDDDDGGD..
..DGGDDDDGGD..
..DDDDDDDDDD..
..DDDmmmmDDD..
...DmMMMMmD...
....mMMMMm....""",
 "afro": """
....HHHHHH....
..HHHHHHHHHH..
.HHHHHHHHHHHH.
.HHHHHHHHHHHH.
.HHGGGGGGGGHH.
.HHSSSSSSSSHH.
..HSSSSSSSSH..
..SSESSSSESS..
..SSESSSSESS..
..SSSSSSSSSS..
...SSSssSSS...
....SSSSSS....""",
 "shades": """
..............
......HHHH....
....HHHHHHH...
...HHHHHHHHH..
..sHHHHHHHHH..
..sSSSSSHHHH..
..SSSSSSSSSS..
.DDDDDDDDDDDD.
..DDGDSSDDGD..
..SSSSSSSSSS..
...SSSssSSS...
....SSSSSS....""",
 "ledmask": """
..............
..............
....HHHHHH....
...HHHHHHHH...
..HHHHHHHHHH..
..HDDDDDDDDH..
..DDGDDDDGDD..
..DGDGDDGDGD..
..DDDDDDDDDD..
..DDGDDDDGDD..
...DDGGGGDD...
....DDDDDD....""",
 "topknot": """
......HH......
.....HHHH.....
......HH......
....HHHHHH....
...HHHHHHHH...
..HHSSSSSSHH..
..SSSSSSSSSS..
..SSESSSSESS..
..SSESSSSESS..
..GGGGGGGGGG..
...GgGggGgG...
....GGGGGG....""",
 "beanie": """
..............
.....CCCC.....
...CCCCCCCC...
..CCCCCCCCCC..
..GGGGGGGGGG..
..cccccccccc..
..SSSSSSSSSS..
..SSESSSSESS..
..SSESSSSESS..
..HHSSSSSSHH..
...HHHssHHH...
....HHHHHH....""",
 "tvhead": """
...M......M...
....M....M....
..MMMMMMMMMM..
..MDDDDDDDDM..
..MDDDDDDDDM..
..MDGGDDGGDM..
..MDGGDDGGDM..
..MDDDDDDDDM..
..MDDGGGGDDM..
..MDDDDDDDDM..
..MMMMMMMMmM..
....mmmmmm....""",
 "horns": """
.G..........G.
.GG........GG.
..GGHHHHHHGG..
...HHHHHHHH...
..HHHHHHHHHH..
..HHSSSSSSHH..
..HSSSSSSSSH..
..SSESSSSESS..
..SSESSSSESS..
..SSSSSSSSSS..
...SSSssSSS...
....SSSSSS....""",
 "fringe": """
..............
..............
....HHHHHH....
...HHHHHHHH...
..HHHHHHHHHH..
..HHHHHHSSHH..
..HHHHHSSSSH..
..HHHHSSSESS..
..HHHSSSSESS..
..HHSSSSSSSS..
..HSSSSssSS...
....SSSSSS....""",
 "cyclops": """
..............
..............
....SSSSSS....
...SSSSSSSS...
..SSSSSSSSSS..
..SSSSSSMMMM..
..SSSSSMDDDM..
..SSESSMDGDM..
..SSESSMDDDM..
..SSSSSSMMMM..
...mmmmmmmm...
....mMMMMm....""",
}

BODIES = {
 "jacket": """
.....JTTJ.....
....JJTTJJ....
...JJJTTJJJ...
...JjJTTJjJ...
...SjJTTJjS...
....JJGGJJ....
....PPPPPP....
....PP..PP....
....Pp..pP....
...BBB..BBB...""",
 "coat": """
.....JTTJ.....
....JJTTJJ....
...JJJTTJJJ...
...JjJTTJjJ...
...SjJJJJjS...
....JJJJJJ....
....JJJJJJ....
....JJjjJJ....
....PP..PP....
...BBB..BBB...""",
 "armor": """
.....MMMM.....
....MMMMMM....
...MMMGGMMM...
...MmMGGMmM...
...MmMMMMmM...
....mMMMMm....
....PPPPPP....
....PP..PP....
....MM..MM....
...MMM..MMM...""",
 "hoodie": """
.....JJJJ.....
....JJJJJJ....
...JJTJJTJJ...
...JjTJJTjJ...
...SjJJJJjS...
....JjjjjJ....
....PPPPPP....
....PP..PP....
....Pp..pP....
...BBB..BBB...""",
 "suit": """
.....JWWJ.....
....JJWWJJ....
...JJJGGJJJ...
...JjJGGJjJ...
...SjJJJJjS...
....JJJJJJ....
....PPPPPP....
....PP..PP....
....PP..PP....
...BBB..BBB...""",
 "vest": """
.....JTTJ.....
....JJTTJJ....
...SJJTTJJS...
...SJJTTJJS...
...SJJTTJJS...
....JJGGJJ....
....PPPPPP....
....PP..PP....
....Pp..pP....
...BBB..BBB...""",
 "robot": """
......MM......
....MMMMMM....
...MMDDDDMM...
...MmDGGDmM...
...MmDDDDmM...
....MMMMMM....
....mm..mm....
....MM..MM....
....MM..MM....
...MMM..MMM...""",
}

# Hair that falls past the chin: drawn over the body's first rows.
TAILS = {
 "longhair": ["..HH......HH..", "..HH......HH..", "..H........H.."],
 "catears":  ["..HH......HH..", "..H........H.."],
}

OUTLINE, DARK, EYE, WHITE, LENS = "#0a0c18", "#161a2b", "#10121c", "#f4f7ff", "#e8fbff"
METAL, METAL_D = "#aab4c8", "#6f7a92"

SKIN = {"light": "#f6cfa8", "tan": "#e0a877", "brown": "#b0744a", "dark": "#7a4a2e", "pale": "#fbe3d0",
        "synth": "#b9d6e0", "lilac": "#d5c3f2", "olive": "#c9b07a"}
NEON = {"cyan": "#19e6ff", "magenta": "#ff3bd4", "lime": "#b4ff39", "orange": "#ff8a1f", "yellow": "#ffe04a",
        "violet": "#a070ff", "red": "#ff4060", "mint": "#35f0a8", "blue": "#3d8bff", "pink": "#ff86c8",
        "white": "#eef2ff", "amber": "#ffb52e"}
CLOTH = {"ink": "#363d63", "plum": "#5a3068", "teal": "#1f5a5e", "brown": "#6a4a2c", "black": "#2f3344",
         "white": "#dfe6f2", "wine": "#8e2436", "olive": "#4a5a2c", "navy": "#243a78", "rain": "#e6b422",
         "hivis": "#e0651a", "grey": "#565d72", "pine": "#1f5a3a", "rose": "#b0457a", "sky": "#2f7fb5"}
HAIR = {"black": "#262a3d", "white": "#eef2ff", "brown": "#5a3a22", "blond": "#e8c860", "grey": "#8f96a8", "red": "#c2412d"}

def rgb(c): return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5))
def hexc(t): return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in t)
def shade(c, f=0.7): return hexc([v * f for v in rgb(c)])
def col(name):
    for table in (NEON, CLOTH, HAIR, SKIN):
        if name in table: return table[name]
    return name  # already a hex colour

# id, name, head, body, skin, hair, accent, jacket, trim, pants, boots, [helmet/cap]
# Ordered so neighbours differ in both shape and colour.
CAST = [
 ("riot",    "Riot",    "mohawk",   "vest",   "tan",   "black", "magenta", "black", "yellow",  "ink",   "black"),
 ("cipher",  "Cipher",  "hood",     "hoodie", "light", "black", "cyan",    "ink",   "cyan",    "black", "black"),
 ("lumen",   "Lumen",   "visor",    "jacket", "brown", "white", "lime",    "white", "lime",    "grey",  "white"),
 ("tinker",  "Tinker",  "android",  "robot",  "synth", "black", "orange",  "grey",  "orange",  "grey",  "black"),
 ("koi",     "Koi",     "catears",  "hoodie", "pale",  "pink",  "white",   "rose",  "white",   "ink",   "white"),
 ("rook",    "Rook",    "helmet",   "armor",  "tan",   "black", "red",     "black", "red",     "black", "black", "white"),
 ("static",  "Static",  "spiky",    "jacket", "light", "yellow","blue",    "navy",  "yellow",  "black", "white"),
 ("moth",    "Moth",    "gasmask",  "coat",   "pale",  "grey",  "amber",   "brown", "amber",   "black", "brown"),
 ("vanta",   "Vanta",   "longhair", "coat",   "dark",  "violet","violet",  "black", "violet",  "black", "black"),
 ("fuse",    "Fuse",    "cap",      "vest",   "brown", "black", "orange",  "hivis", "black",   "ink",   "black", "hivis"),
 ("pixel",   "Pixel",   "ledmask",  "hoodie", "light", "white", "mint",    "black", "mint",    "black", "white"),
 ("opal",    "Opal",    "buns",     "jacket", "tan",   "cyan",  "pink",    "white", "pink",    "sky",   "white"),
 ("brick",   "Brick",   "beanie",   "coat",   "light", "red",   "yellow",  "olive", "yellow",  "brown", "black", "wine"),
 ("zero",    "Zero",    "tvhead",   "suit",   "synth", "black", "cyan",    "black", "cyan",    "black", "black"),
 ("sable",   "Sable",   "afro",     "jacket", "dark",  "black", "amber",   "wine",  "amber",   "black", "black"),
 ("vex",     "Vex",     "shades",   "suit",   "pale",  "white", "red",     "black", "red",     "black", "black"),
 ("kestrel", "Kestrel", "topknot",  "armor",  "tan",   "black", "red",     "ink",   "red",     "ink",   "black"),
 ("jolt",    "Jolt",    "horns",    "vest",   "lilac", "black", "lime",    "plum",  "lime",    "black", "black"),
 ("dusk",    "Dusk",    "fringe",   "hoodie", "pale",  "blue",  "violet",  "plum",  "violet",  "black", "black"),
 ("mako",    "Mako",    "cyclops",  "jacket", "brown", "black", "cyan",    "teal",  "cyan",    "black", "black"),
 ("nyx",     "Nyx",     "bob",      "coat",   "light", "black", "magenta", "ink",   "magenta", "black", "black"),
 ("quill",   "Quill",   "slick",    "suit",   "tan",   "blond", "blue",    "navy",  "blue",    "navy",  "black"),
 ("glitch",  "Glitch",  "mohawk",   "jacket", "pale",  "black", "cyan",    "plum",  "magenta", "black", "white"),
 ("rust",    "Rust",    "android",  "robot",  "synth", "black", "lime",    "grey",  "lime",    "grey",  "black"),
 ("wisp",    "Wisp",    "hood",     "coat",   "light", "black", "pink",    "white", "pink",    "grey",  "white"),
 ("talon",   "Talon",   "helmet",   "jacket", "tan",   "black", "yellow",  "black", "yellow",  "black", "black", "rain"),
 ("cinder",  "Cinder",  "longhair", "vest",   "brown", "red",   "orange",  "black", "orange",  "ink",   "black"),
 ("byte",    "Byte",    "spiky",    "hoodie", "dark",  "mint",  "mint",    "pine",  "white",   "black", "white"),
 ("umbra",   "Umbra",   "gasmask",  "armor",  "pale",  "white", "magenta", "black", "magenta", "black", "black"),
 ("sprocket","Sprocket","tvhead",   "robot",  "synth", "black", "yellow",  "grey",  "yellow",  "grey",  "black"),
 ("yara",    "Yara",    "catears",  "jacket", "brown", "orange", "amber",   "wine",  "amber",   "black", "black"),
 ("onyx",    "Onyx",    "visor",    "armor",  "dark",  "black", "magenta", "black", "magenta", "black", "black"),
 ("blitz",   "Blitz",   "cap",      "jacket", "light", "black", "lime",    "black", "lime",    "grey",  "white", "sky"),
 ("ziggy",   "Ziggy",   "afro",     "hoodie", "tan",   "pink",  "cyan",    "rain",  "black",   "ink",   "white"),
 ("shade",   "Shade",   "shades",   "coat",   "dark",  "mint", "mint",    "ink",   "mint",    "black", "black"),
 ("neon",    "Neon",    "buns",     "vest",   "pale",  "lime",  "magenta", "black", "lime",    "black", "black"),
 ("rune",    "Rune",    "ledmask",  "coat",   "tan",   "white", "orange",  "wine",  "orange",  "black", "black"),
 ("orbit",   "Orbit",   "cyclops",  "armor",  "light", "black", "amber",   "grey",  "amber",   "ink",   "black"),
 ("tempo",   "Tempo",   "beanie",   "hoodie", "brown", "black", "white",   "sky",   "white",   "ink",   "white", "ink"),
 ("ronin",   "Ronin",   "topknot",  "coat",   "pale",  "white", "blue",    "navy",  "white",   "black", "black"),
 ("hazard",  "Hazard",  "horns",    "jacket", "olive", "black", "orange",  "black", "orange",  "black", "black"),
 ("lyric",   "Lyric",   "fringe",   "jacket", "dark",  "white", "yellow",  "ink",   "yellow",  "black", "black"),
 ("dot",     "Dot",     "bob",      "hoodie", "tan",   "orange","lime",    "pine",  "lime",    "black", "white"),
 ("marlow",  "Marlow",  "slick",    "coat",   "dark",  "grey",  "amber",   "brown", "amber",   "black", "brown"),
]

def rows(text, n):
    r = [l for l in text.strip("\n").split("\n")]
    assert len(r) == n, (len(r), n, text)
    for l in r: assert len(l) == W, (l, len(l))
    return r

def grid_for(c):
    cid, name, head, body, skin, hair, accent, jacket, trim, pants, boots, *rest = c
    hat = col(rest[0]) if rest else col(jacket)
    S, Hc, G, J, T, P, B = col(skin), col(hair), col(accent), col(jacket), col(trim), col(pants), col(boots)
    pal = {"S": S, "s": shade(S, .78), "H": Hc, "h": shade(Hc, .68), "G": G, "g": shade(G, .6),
           "J": J, "j": shade(J, .72), "T": T, "P": P, "p": shade(P, .7), "B": B if B != P else shade(B, 1.35),
           "C": hat, "c": shade(hat, .62), "M": METAL, "m": METAL_D, "D": DARK, "E": EYE, "W": WHITE, "L": LENS}
    art = [("." * W)] + rows(HEADS[head], HEAD_H) + rows(BODIES[body], BODY_H) + [("." * W)]
    g = [[pal.get(ch) for ch in line] for line in art]
    for i, line in enumerate(TAILS.get(head, [])):
        for x, ch in enumerate(line):
            if ch != ".": g[1 + HEAD_H + i][x] = pal[ch]
    # A shadow line under the chin, so the head reads apart from the body.
    y = 1 + HEAD_H
    for x in range(W):
        if g[y][x] and g[y - 1][x] and head not in ("hood",): g[y][x] = shade(g[y][x], .8)
    out = [row[:] for row in g]
    for yy in range(H):
        for xx in range(W):
            if g[yy][xx]: continue
            if any(0 <= yy + dy < H and 0 <= xx + dx < W and g[yy + dy][xx + dx] for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out[yy][xx] = OUTLINE
    return out, G

def svg(g, h):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {h}" shape-rendering="crispEdges">']
    for y in range(h):
        x = 0
        while x < W:
            c = g[y][x]
            if not c: x += 1; continue
            n = 1
            while x + n < W and g[y][x + n] == c: n += 1
            parts.append(f'<rect x="{x}" y="{y}" width="{n}" height="1" fill="{c}"/>')
            x += n
    return "".join(parts) + "</svg>\n"

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "chars"); os.makedirs(out, exist_ok=True)
    ids = [c[0] for c in CAST]; assert len(set(ids)) == len(ids), "duplicate ids"
    roster, grids = [], []
    for c in CAST:
        g, accent = grid_for(c)
        open(os.path.join(out, f"{c[0]}.svg"), "w").write(svg(g, H))
        open(os.path.join(out, f"{c[0]}-face.svg"), "w").write(svg(g, FACE))
        roster.append({"id": c[0], "name": c[1], "color": accent, "look": f"{c[2]} / {c[3]}"})
        grids.append((c, g))
    js = "// Made by build.py: don't edit, run it again.\nexport const ROSTER = " + json.dumps(roster, indent=1) + ";\n"
    open(os.path.join(here, "roster.js"), "w").write(js)
    # The mods that draw the cast keep their own copy of cast.js and roster.js (mods can't
    # import from each other). Only the mods named in COPIES, and only over a cast.js that is
    # ours: other layouts have a cast.js of their own (Neon Borough's crew and my-agents).
    mods = os.path.dirname(here)
    for name in COPIES:
        there = os.path.join(mods, name)
        if not os.path.isdir(there): continue
        target = os.path.join(there, "cast.js")
        if os.path.exists(target) and MARK not in open(target).read():
            print("skipped", name, "(its cast.js isn't ours)"); continue
        for f in ("cast.js", "roster.js"):
            open(os.path.join(there, f), "w").write(open(os.path.join(here, f)).read())
        print("copied cast.js and roster.js to", name)
    if "--sheet" in sys.argv:
        from PIL import Image, ImageDraw
        path = sys.argv[sys.argv.index("--sheet") + 1]; k = 6; cols = 11; pad = 10
        cw, ch = W * k + pad, H * k + pad + 12
        n = len(grids); sheet = Image.new("RGB", (cols * cw + pad, ((n + cols - 1) // cols) * ch + pad), "#0d1220")
        d = ImageDraw.Draw(sheet)
        for i, (c, g) in enumerate(grids):
            ox, oy = pad + (i % cols) * cw, pad + (i // cols) * ch
            for y in range(H):
                for x in range(W):
                    if g[y][x]: d.rectangle([ox + x * k, oy + y * k, ox + x * k + k - 1, oy + y * k + k - 1], fill=g[y][x])
            d.text((ox, oy + H * k + 1), c[0], fill="#8aa")
        sheet.save(path)
        # the faces at sidebar size (28px: 2px a cell), on the sidebar's dark
        k = 2; faces = Image.new("RGB", (len(grids) * 34 + 6, 40), "#07110f"); d = ImageDraw.Draw(faces)
        for i, (c, g) in enumerate(grids):
            ox, oy = 6 + i * 34, 6
            for y in range(FACE):
                for x in range(W):
                    if g[y][x]: d.rectangle([ox + x * k, oy + y * k, ox + x * k + k - 1, oy + y * k + k - 1], fill=g[y][x])
        faces.save(path.replace(".png", "-faces.png"))
    print(len(CAST), "characters")

if __name__ == "__main__":
    main()
