"""
Builds the ground textures from USGS aerial imagery (public domain, USGS National Map, USGSImageryOnly).

  python3 scripts/terrain.py

Writes src/assets/terrain-near.jpg, terrain-far.jpg, terrain-rough.png (sea = glossy) and terrain.json
(extents in game metres: x east, z south, origin 5.5 m east of the tower base, as in src/sim/constants.ts).
"""
import io, json, math, os, sys, urllib.request
from PIL import Image, ImageFilter

TOWER = (25.99689, -97.15705)  # tower base, read off the imagery
TOWER_GAME_X = -7
URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets")
CACHE = os.environ.get("TILE_CACHE", "/tmp/usgs-tiles")


def gpx(lat, lon, z):
    n = 2 ** z * 256
    return (lon + 180) / 360 * n, (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n


def tile(z, x, y):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, f"{z}_{x}_{y}.jpg")
    if not os.path.exists(f):
        req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": "starship-landing-game terrain script"})
        open(f, "wb").write(urllib.request.urlopen(req, timeout=60).read())
    return Image.open(f).convert("RGB")


def mosaic(z, size_px):
    """Square image of size_px centred on the tower, plus its metres-per-pixel."""
    cx, cy = gpx(*TOWER, z)
    x0, y0 = cx - size_px / 2, cy - size_px / 2
    im = Image.new("RGB", (size_px, size_px))
    for ty in range(int(y0 // 256), int((y0 + size_px) // 256) + 1):
        for tx in range(int(x0 // 256), int((x0 + size_px) // 256) + 1):
            im.paste(tile(z, tx, ty), (int(tx * 256 - x0), int(ty * 256 - y0)))
        print(f"z{z} row {ty}", file=sys.stderr)
    mpp = 156543.03392 * math.cos(math.radians(TOWER[0])) / 2 ** z
    return im, mpp


def sea_mask(im):
    """Open water: blue-green and fairly saturated (the Gulf), not the brown-green lagoon flats."""
    m = Image.new("L", im.size)
    px, mp = im.load(), m.load()
    for y in range(im.size[1]):
        for x in range(im.size[0]):
            r, g, b = px[x, y]
            mp[x, y] = 255 if (b > r + 18 and g > r + 10 and b > 70) else 0
    return m.filter(ImageFilter.MedianFilter(7))


def fill_gaps(im, mpp, shore_x):
    """
    USGS has no imagery far offshore or across the border. Fill those (black) pixels: open sea with the
    mean colour of the imaged offshore water, land by tiling a patch of real land texture, then feather the seam.
    """
    w, h = im.size
    px = im.load()
    gap = Image.new("L", im.size)
    gp = gap.load()
    sea = [0, 0, 0, 0]
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if r + g + b < 20:
                gp[x, y] = 255
            elif (x - w / 2) * mpp + TOWER_GAME_X > shore_x + 2500:
                sea[0] += r; sea[1] += g; sea[2] += b; sea[3] += 1
    sea_c = tuple(int(c / max(1, sea[3])) for c in sea[:3])
    patch = im.crop((80, 1200, 400, 1500))  # real coastal-plain land west of the lagoon
    fill = Image.new("RGB", im.size, sea_c)
    for y in range(0, h, patch.size[1]):
        for x in range(0, w, patch.size[0]):
            if (x + patch.size[0] - w / 2) * mpp + TOWER_GAME_X < shore_x:
                fill.paste(patch, (x, y))
    fill = fill.filter(ImageFilter.GaussianBlur(1))
    feather = gap.filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(48))
    return Image.composite(fill, im, feather)


near, near_mpp = mosaic(16, 2048)
far, far_mpp = mosaic(13, 2048)
far = fill_gaps(far, far_mpp, 720)


def stats(im):
    from PIL import ImageStat
    st = ImageStat.Stat(im)
    return st.mean, st.stddev


# The wide image comes from a different survey: match its colours to the detailed one over the shared area,
# then fade the detailed patch's border into the wide image so there is no seam.
inner = near.size[0] * near_mpp / far_mpp
c = far.size[0] / 2
box = (int(c - inner / 2), int(c - inner / 2), int(c + inner / 2), int(c + inner / 2))
(fm, fs), (nm, ns) = stats(far.crop(box)), stats(near.resize((int(inner), int(inner))))
bands = [b.point(lambda v, i=i: max(0, min(255, int((v - fm[i]) * ns[i] / max(1, fs[i]) + nm[i])))) for i, b in enumerate(far.split())]
far = Image.merge("RGB", bands)
under = far.crop(box).resize(near.size, Image.BICUBIC)
edge = Image.new("L", near.size, 0)
from PIL import ImageDraw
ImageDraw.Draw(edge).rectangle((160, 160, near.size[0] - 161, near.size[1] - 161), fill=255)
near = Image.composite(near, under, edge.filter(ImageFilter.GaussianBlur(60)))

os.makedirs(OUT, exist_ok=True)
near.save(os.path.join(OUT, "terrain-near.jpg"), quality=78, optimize=True, progressive=True)
far.save(os.path.join(OUT, "terrain-far.jpg"), quality=78, optimize=True, progressive=True)

# roughness for the far texture (green channel): sea glossy, land matte
mask = sea_mask(far.resize((1024, 1024)))
rough = Image.merge("RGB", [Image.new("L", mask.size, 255), mask.point(lambda v: 255 - int(v * 0.82)), Image.new("L", mask.size, 255)])
rough.save(os.path.join(OUT, "terrain-rough.png"), optimize=True)
nmask = sea_mask(near.resize((1024, 1024)))
nrough = Image.merge("RGB", [Image.new("L", nmask.size, 255), nmask.point(lambda v: 255 - int(v * 0.82)), Image.new("L", nmask.size, 255)])
nrough.save(os.path.join(OUT, "terrain-near-rough.png"), optimize=True)

# shoreline: for rows of the near mask within ±2 km of the tower, the first sea pixel from the west
xs, zs = [], []
w = nmask.size[0]
mpp = near_mpp * near.size[0] / w
mp = nmask.load()
for row in range(w):
    zm = (row - w / 2) * mpp
    if abs(zm) > 2000:
        continue
    for col in range(w // 2, w):
        if all(mp[c, row] for c in range(col, min(w, col + 6))):
            xs.append((col - w / 2) * mpp + TOWER_GAME_X)
            zs.append(zm)
            break
n = len(xs)
mz, mx = sum(zs) / n, sum(xs) / n
slope = sum((z - mz) * (x - mx) for z, x in zip(zs, xs)) / sum((z - mz) ** 2 for z in zs)
shore = mx - slope * mz

meta = {
    "source": "USGS National Map, USGSImageryOnly (public domain)",
    "near": {"size": near.size[0] * near_mpp, "centre": [TOWER_GAME_X, 0]},
    "far": {"size": far.size[0] * far_mpp, "centre": [TOWER_GAME_X, 0]},
    "shore": {"x": round(shore, 1), "slope": round(slope, 4)},
}
json.dump(meta, open(os.path.join(OUT, "terrain.json"), "w"), indent=2)
print(json.dumps(meta, indent=2))
