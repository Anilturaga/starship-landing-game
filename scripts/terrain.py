"""
Builds the ground from USGS data (all public domain, USGS The National Map):

  - NAIP Plus orthoimagery (imagery.nationalmap.gov), up to 0.3 m per pixel, 2024-25
  - USGSImageryOnly tiles (basemap.nationalmap.gov) for the wide 35 km view
  - 3DEP lidar elevation (elevation.nationalmap.gov) for the dunes

  python3 scripts/terrain.py

Writes src/assets/terrain-*.jpg|png and terrain.json. Game coordinates: x east, z south, metres,
origin such that the tower base is at (TOWER_GAME_X, 0) as in src/sim/constants.ts.
"""
import io, json, math, os, sys, urllib.request
import numpy as np
from PIL import Image, ImageFilter

TOWER = (25.996127, -97.154742)  # Pad A tower base, from the NAIP imagery (tower shadow and relief displacement)
TOWER_GAME_X = -7
PAD, MID, NEAR = 600, 2000, 6000  # patch sizes, m (square, centred on the tower)
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "assets")
CACHE = os.environ.get("TILE_CACHE", "/tmp/usgs-tiles")
UA = {"User-Agent": "starship-landing-game terrain script"}
R = 6378137
K = 1 / math.cos(math.radians(TOWER[0]))  # Web Mercator scale at this latitude
TX = math.radians(TOWER[1]) * R
TY = math.log(math.tan(math.pi / 4 + math.radians(TOWER[0]) / 2)) * R


def get(url, name):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, name)
    if not os.path.exists(f):
        open(f, "wb").write(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180).read())
        print("fetched", name, file=sys.stderr)
    return f


def bbox(size):
    h = size / 2 * K
    return f"{TX - h},{TY - h},{TX + h},{TY + h}"


def naip(size, px):
    u = ("https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage"
         f"?bbox={bbox(size)}&bboxSR=3857&imageSR=3857&size={px},{px}&format=jpg&f=image")
    return Image.open(get(u, f"naip_{TOWER[0]}_{TOWER[1]}_{size}_{px}.jpg")).convert("RGB")


def dem(size, px):
    u = ("https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
         f"?bbox={bbox(size)}&bboxSR=3857&imageSR=3857&size={px},{px}&format=tiff&pixelType=F32"
         "&interpolation=RSP_BilinearInterpolation&f=image")
    return np.array(Image.open(get(u, f"dem_{TOWER[0]}_{TOWER[1]}_{size}_{px}.tif")), dtype=np.float32)


def basemap(z, size_px):
    """Square mosaic of USGSImageryOnly tiles centred on the tower, and its metres per pixel."""
    n = 2 ** z * 256
    cx = (TOWER[1] + 180) / 360 * n
    cy = (1 - math.log(math.tan(math.radians(TOWER[0])) + 1 / math.cos(math.radians(TOWER[0]))) / math.pi) / 2 * n
    x0, y0 = cx - size_px / 2, cy - size_px / 2
    im = Image.new("RGB", (size_px, size_px))
    for ty in range(int(y0 // 256), int((y0 + size_px) // 256) + 1):
        for tx in range(int(x0 // 256), int((x0 + size_px) // 256) + 1):
            u = f"https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{ty}/{tx}"
            im.paste(Image.open(get(u, f"{z}_{tx}_{ty}.jpg")).convert("RGB"), (int(tx * 256 - x0), int(ty * 256 - y0)))
    return im, 156543.03392 / K / 2 ** z


def to_px(im, size, x, z):
    """Game (x, z) to pixel in a patch of `size` metres centred on the tower."""
    s = im.size[0] / size
    return (x - TOWER_GAME_X) * s + im.size[0] / 2, z * s + im.size[1] / 2


def fill(im, hole):
    """Fills masked pixels (hole: bool array) by normalised convolution at growing radii, then adds grain."""
    a = np.asarray(im, dtype=np.float32)
    keep = (~hole).astype(np.float32)
    out = a.copy()
    todo = hole.copy()
    for i, r in enumerate((4, 10, 24, 60, 140, 300)):
        num = np.asarray(Image.fromarray(np.uint8(np.clip(a * keep[..., None], 0, 255))).filter(ImageFilter.BoxBlur(r)), dtype=np.float32)
        den = np.asarray(Image.fromarray(np.uint8(keep * 255)).filter(ImageFilter.BoxBlur(r)), dtype=np.float32)[..., None] / 255
        est = num / np.maximum(den, 1e-3)
        ok = todo & (den[..., 0] > (0.3 if i < 5 else 0.001))
        out[ok] = est[ok]
        todo &= ~ok
    rng = np.random.default_rng(1)
    out[hole] += rng.normal(0, 4, (int(hole.sum()), 1))
    return Image.fromarray(np.uint8(np.clip(out, 0, 255)))


def paint_out_tower(im, size):
    """The orthophoto shows the 146 m tower 'lying' west-east with its shadow (relief displacement): remove it."""
    w = im.size[0]
    yy, xx = np.mgrid[0:w, 0:w]
    x = (xx - w / 2) * size / w + TOWER_GAME_X
    z = (yy - w / 2) * size / w
    hole = (x > -12) & (x < 155) & (z > -42) & (z < 26)
    return fill(im, hole)


GULF = np.array([38, 92, 104], dtype=np.float32)  # open-water colour offshore


def mirror_fill(a, gap):
    """Fills gap pixels by reflecting the imagery across the gap's edge (first down the columns, then along rows)."""
    a, gap = a.copy(), gap.copy()
    h, w = gap.shape
    for axis in (0, 1):
        A = a if axis == 0 else a.transpose(1, 0, 2)
        G = gap if axis == 0 else gap.T
        for i in range(G.shape[1]):
            col = G[:, i]
            if not col.any():
                continue
            idx = np.flatnonzero(col)
            start = idx[0]
            if start == 0:
                continue
            src = 2 * start - 1 - idx
            ok = (src >= 0) & ~G[np.clip(src, 0, len(col) - 1), i]
            A[idx[ok], i] = A[src[ok], i]
            G[idx[ok], i] = False
    return a, gap


GULF = np.array([38, 92, 104], dtype=np.float32)  # open-water colour offshore


def sea_fill(im, mpp, shore_x, feather_px=30):
    """
    No imagery well offshore or across the border: east of the shore, fill with open-water colour (feathered);
    west of it, mirror the neighbouring land across the edge of the gap, which leaves no seam.
    """
    a = np.asarray(im, dtype=np.float32)
    w = a.shape[0]
    xs = (np.arange(w) - w / 2) * mpp + TOWER_GAME_X
    dark = a.sum(axis=2) < 25
    west = np.broadcast_to(xs[None, :] < shore_x - 200, dark.shape)
    a, left = mirror_fill(a, dark & west)
    sea_gap = dark & ~west | left
    feather = np.asarray(Image.fromarray(np.uint8(sea_gap * 255)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(feather_px)), dtype=np.float32)[..., None] / 255
    return Image.fromarray(np.uint8(a * (1 - feather) + GULF * feather))


def sea_mask(im):
    """Open water: bluer and greener than it is red (the Gulf), not the brown-green flats."""
    a = np.asarray(im.resize((1024, 1024)), dtype=np.int32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    m = (b > r + 14) & (g > r + 8) & (b > 60)
    return Image.fromarray(np.uint8(m * 255)).filter(ImageFilter.MedianFilter(7))


def rough(mask):
    """Roughness map for three.js (green channel): sea glossy, land matte."""
    g = mask.point(lambda v: 255 - int(v * 0.62))  # sea roughness ~0.38: glints, but not a mirror
    full = Image.new("L", mask.size, 255)
    return Image.merge("RGB", [full, g, full])


def match(src, region, ref):
    """Colour-match src to ref, using the statistics of `region` (the part of src that ref also shows)."""
    s, g, r = (np.asarray(i, dtype=np.float32) for i in (src, region, ref))
    o = (s - g.mean((0, 1))) * (r.std((0, 1)) / np.maximum(g.std((0, 1)), 1)) + r.mean((0, 1))
    return Image.fromarray(np.uint8(np.clip(o, 0, 255)))


def blend_border(inner, outer_crop, px=120):
    """Fades the border of an inner patch into the (upsampled) outer patch so there is no seam."""
    m = Image.new("L", inner.size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(m).rectangle((px, px, inner.size[0] - px - 1, inner.size[1] - px - 1), fill=255)
    return Image.composite(inner, outer_crop.resize(inner.size, Image.BICUBIC), m.filter(ImageFilter.GaussianBlur(px / 2.5)))


def crop_centre(im, size, inner):
    w = im.size[0] * inner / size
    c = im.size[0] / 2
    return im.crop((int(c - w / 2), int(c - w / 2), int(c + w / 2), int(c + w / 2)))


# --- imagery
pad = paint_out_tower(naip(PAD, 2048), PAD)
mid = paint_out_tower(naip(MID, 2048), MID)
near = naip(NEAR, 2048)
near = paint_out_tower(near, NEAR)

# shoreline from the lidar: per row, the first point east of the dunes that stays at sea level
H = dem(MID, 513)
n = H.shape[0]
g = (np.arange(n) - n // 2) * MID / (n - 1)
xs, zs = [], []
for row in range(n):
    if abs(g[row]) > 900:
        continue
    for col in range(n // 2, n - 8):
        if (H[row, col:col + 8] < 0.25).all():
            xs.append(g[col] + TOWER_GAME_X)
            zs.append(g[row])
            break
slope, shore = np.polyfit(zs, xs, 1)
print("shore", shore, slope, file=sys.stderr)


def geo_sea(im, size):
    """Sea mask from the fitted shoreline (the near-shore water is too pale to find by colour)."""
    w = im.size[0]
    yy, xx = np.mgrid[0:w, 0:w]
    x = (xx - w / 2) * size / w + TOWER_GAME_X
    z = (yy - w / 2) * size / w
    return (x > shore + slope * z + 15) & (np.abs(z) < 2500)


near = sea_fill(near, NEAR / near.size[0], shore)
FAR_SIZE = 35000
far = naip(FAR_SIZE, 2048)  # same survey as the near patches, so the colours agree everywhere
far_mpp = FAR_SIZE / far.size[0]
far = sea_fill(far, far_mpp, shore, feather_px=70)
FAR = FAR_SIZE

# seamless nesting: each patch fades into the one around it at its border
near = blend_border(near, crop_centre(far, FAR, NEAR))
mid = blend_border(match(mid, mid, crop_centre(near, NEAR, MID)), crop_centre(near, NEAR, MID))
pad = blend_border(match(pad, pad, crop_centre(mid, MID, PAD)), crop_centre(mid, MID, PAD), px=160)

os.makedirs(OUT, exist_ok=True)
for name, im in (("pad", pad), ("mid", mid), ("near", near), ("far", far)):
    im.save(os.path.join(OUT, f"terrain-{name}.jpg"), quality=80, optimize=True, progressive=True)
for name, im, size in (("mid", mid, MID), ("near", near, NEAR), ("far", far, FAR)):
    m = np.asarray(sea_mask(im)) > 0
    geo = np.asarray(Image.fromarray(np.uint8(geo_sea(im, size) * 255)).resize(m.shape[::-1])) > 0
    rough(Image.fromarray(np.uint8((m | geo) * 255)).filter(ImageFilter.GaussianBlur(2))).save(os.path.join(OUT, f"terrain-{name}-rough.png"), optimize=True)

# --- heights for the mid patch: dunes and ridges above the pad level, sea and flats at 0,
# flattened around the pad, fading to 0 at the patch edge so it meets the flat patches around it
N = 257
h = dem(MID, N)
c = N // 2
pad_level = float(np.median(h[c - 8:c + 8, c - 8:c + 8]))
h = np.clip(h - pad_level, 0, None)
g = (np.arange(N) - c) * MID / (N - 1)
X, Z = np.meshgrid(g + TOWER_GAME_X, g)
d_pad = np.hypot(X - 14, Z)
h *= np.clip((d_pad - 200) / 120, 0, 1)
edge = np.minimum.reduce([np.abs(X - TOWER_GAME_X + MID / 2), np.abs(X - TOWER_GAME_X - MID / 2), np.abs(Z + MID / 2), np.abs(Z - MID / 2)])
h *= np.clip(edge / 150, 0, 1)
h[X > shore + slope * Z] = 0  # the sea stays flat
SCALE = 0.05  # m per grey level
Image.fromarray(np.uint8(np.clip(np.round(h / SCALE), 0, 255))).save(os.path.join(OUT, "terrain-height.png"), optimize=True)

fa = np.asarray(far, dtype=np.float32)
fx = (np.arange(fa.shape[1]) - fa.shape[1] / 2) * far_mpp + TOWER_GAME_X
land_c = fa[:, fx < shore - 3000].reshape(-1, 3).mean(axis=0)
meta = {
    "apron": {"land": [int(v) for v in land_c], "sea": [int(v) for v in GULF]},
    "source": "USGS The National Map: NAIP Plus orthoimagery, USGSImageryOnly, 3DEP elevation (public domain)",
    "centre": [TOWER_GAME_X, 0],
    "pad": PAD, "mid": MID, "near": NEAR, "far": FAR,
    "height": {"size": N, "scale": SCALE, "max": float(h.max())},
    "shore": {"x": round(float(shore), 1), "slope": round(float(slope), 4)},
}
json.dump(meta, open(os.path.join(OUT, "terrain.json"), "w"), indent=2)
print(json.dumps(meta, indent=2))
