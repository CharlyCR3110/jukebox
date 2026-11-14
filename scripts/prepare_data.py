#!/usr/bin/env python3
"""
Earth Jukebox: reproducible data preparation.

Builds apps/web/public/data/sst/manifest.json plus web-ready frames from:
  * Visual frames: NASA SVS visualization 5101, "Sea Surface Temperature (SST) - Near Real Time"
    (daily equirectangular EXR frames, one file per observation date).
  * Numbers (--mode measured): GHRSST L4 MUR v4.1 (NASA JPL / PO.DAAC), read with earthaccess.
    Requires a free Earthdata Login: EARTHDATA_USERNAME / EARTHDATA_PASSWORD in the
    environment, or a ~/.netrc entry for urs.earthdata.nasa.gov. Credentials never reach the frontend.
  * --mode visual: no credentials. Computes a labeled property of the frame pixels
    (red-blue index). It is NOT a temperature and the app says so.

Usage (from the repo root):
  python scripts/prepare_data.py --mode measured                 # 12 monthly frames, 2025-11-15 … 2026-10-15
  python scripts/prepare_data.py --mode visual
  python scripts/prepare_data.py --mode measured --dates 2026-01-15,2026-02-15,…
  python scripts/prepare_data.py --selftest 2019-11-15          # check the extraction on the anonymous AWS MUR Zarr
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

SVS_ID = 5101
SVS_PAGE = "https://svs.gsfc.nasa.gov/5101/"
SVS_API = "https://svs.gsfc.nasa.gov/api/5101"
SVS_FRAMES = "https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005101/frames/4096x2048_2x1_30p/sst_mur_no-dates/"
SVS_COLORBAR = "https://svs.gsfc.nasa.gov/vis/a000000/a005100/a005101/sst_mur_colorbar_print.jpg"

MUR_SHORT_NAME = "MUR-JPL-L4-GLOB-v4.1"
MUR_PAGE = "https://podaac.jpl.nasa.gov/dataset/MUR-JPL-L4-GLOB-v4.1"
MUR_DOI = "https://doi.org/10.5067/GHGMR-4FJ04"
AWS_ZARR = "s3://mur-sst/zarr-v1"  # AWS Open Data copy of MUR v4.1, anonymous, 2002-06 … ~2020-01

HALF_BOX_DEG = 0.05   # ±0.05° → 11 × 11 cells of the 0.01° MUR grid (~11 km box)
MIN_COVERAGE = 0.5    # a point is valid when ≥ 50 % of its box is open sea with data
OPEN_SEA = 1          # MUR mask flag: 1 = open sea (2 land, 5 lake, 9 sea with ice, 13 lake with ice)
FEATURE_HALF_BOX_DEG = 0.5
DISPLAY_SIZE = 2048
UA = {"User-Agent": "EarthJukebox-prepare/1.0 (NASA Space Apps 2026)"}

SAMPLING_MEASURED = (
    f"Mean of MUR v4.1 analysed_sst over valid open-sea cells (mask == {OPEN_SEA}) within ±{HALF_BOX_DEG}° "
    f"latitude/longitude of the location (≤ 11 × 11 cells of the 0.01° grid). Valid when ≥ {int(MIN_COVERAGE * 100)} % "
    "of the box has data. Land, lake, ice-flagged and fill cells are excluded, never zero-filled. "
    "Kelvin → °C by subtracting 273.15 after applying the variable's scale_factor/add_offset."
)
SAMPLING_VISUAL = (
    f"Mean of (R − B) / 255 over colored (non-grey) pixels of the sRGB SVS frame within ±{FEATURE_HALF_BOX_DEG}° "
    "of the location. This describes the visualization's colors only: it is not a temperature."
)


# ----------------------------------------------------------------------------- helpers
def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url: str, dest: Path) -> Path:
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.rename(dest)
    return dest


def read_json(url: str):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.load(r)


def monthly_dates(start: str, end: str, day: int = 15) -> list[str]:
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    out = []
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}-{day:02d}")
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def svs_available_dates() -> set[str]:
    with urllib.request.urlopen(urllib.request.Request(SVS_FRAMES, headers=UA), timeout=60) as r:
        html = r.read().decode("utf-8", "replace")
    return {f"{d[:4]}-{d[4:6]}-{d[6:]}" for d in re.findall(r"sst_mur_(\d{8})_no-dates\.exr", html)}


def svs_frame_url(date: str) -> str:
    return f"{SVS_FRAMES}sst_mur_{date.replace('-', '')}_no-dates.exr"


# ----------------------------------------------------------------------------- frames
def exr_to_srgb(path: Path) -> np.ndarray:
    """SVS EXR frames hold linear-light RGB in [0, 1]; encode to 8-bit sRGB."""
    import OpenEXR

    with OpenEXR.File(str(path)) as f:
        px = f.channels()["RGBA"].pixels.astype(np.float32)[..., :3]
    lin = np.clip(np.nan_to_num(px), 0.0, 1.0)
    srgb = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    return (srgb * 255 + 0.5).astype(np.uint8)


def equirect_to_mercator(img: np.ndarray, size: int = DISPLAY_SIZE) -> np.ndarray:
    """Exact row remap from plate carrée (90°N…90°S) to Web Mercator (±85.0511°)."""
    h = img.shape[0]
    j = np.arange(size, dtype=np.float64) + 0.5
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * j / size))))
    src = np.clip((90.0 - lat) / 180.0 * h - 0.5, 0, h - 1)
    r0 = np.floor(src).astype(int)
    r1 = np.minimum(r0 + 1, h - 1)
    w = (src - r0)[:, None, None]
    rows = img[r0].astype(np.float32) * (1 - w) + img[r1].astype(np.float32) * w
    out = Image.fromarray(np.clip(rows + 0.5, 0, 255).astype(np.uint8)).resize((size, size), Image.LANCZOS)
    return np.asarray(out)


def colorbar_stops(path: Path, n: int = 21) -> dict | None:
    """Sample the SVS colorbar (1024×576 print JPEG): bar spans −5 °C (x≈127) … 35 °C (x≈897) at y≈290."""
    img = np.asarray(Image.open(path).convert("RGB"))
    if img.shape[:2] != (576, 1024):
        log(f"colorbar: unexpected size {img.shape}, legend falls back to frontend default")
        return None
    x0, x1, y = 127, 897, 290
    stops = []
    for i in range(n):
        x = round(x0 + (x1 - x0) * i / (n - 1))
        x = min(max(x, x0 + 3), x1 - 3)  # avoid tick marks at the ends
        r, g, b = img[y - 4 : y + 5, x - 1 : x + 2].reshape(-1, 3).mean(axis=0)
        stops.append(f"#{int(r):02x}{int(g):02x}{int(b):02x}")
    return {"minC": -5, "maxC": 35, "stops": stops, "source": SVS_COLORBAR}


def visual_feature(img: np.ndarray, lat: float, lon: float) -> dict:
    h, w = img.shape[:2]
    r0 = int((90 - (lat + FEATURE_HALF_BOX_DEG)) / 180 * h)
    r1 = int(math.ceil((90 - (lat - FEATURE_HALF_BOX_DEG)) / 180 * h))
    c0 = int((lon - FEATURE_HALF_BOX_DEG + 180) / 360 * w)
    c1 = int(math.ceil((lon + FEATURE_HALF_BOX_DEG + 180) / 360 * w))
    box = img[max(0, r0) : min(h, r1), max(0, c0) : min(w, c1)].reshape(-1, 3).astype(np.float32)
    colored = (box.max(axis=1) - box.min(axis=1)) > 12  # land is rendered grey
    cov = float(colored.mean()) if box.size else 0.0
    ok = cov >= MIN_COVERAGE
    val = float(((box[colored, 0] - box[colored, 2]) / 255).mean()) if ok else None
    return {"feature": None if val is None else round(val, 4), "isValid": ok, "coverage": round(cov, 3)}


# ----------------------------------------------------------------------------- numbers
def extract_point(sst, mask, lat: float, lon: float) -> dict:
    """sst in kelvin (decoded), mask with MUR flags; both 2-D (lat ascending, lon)."""
    box = dict(lat=slice(lat - HALF_BOX_DEG, lat + HALF_BOX_DEG), lon=slice(lon - HALF_BOX_DEG, lon + HALF_BOX_DEG))
    v = np.asarray(sst.sel(**box).values, dtype=np.float64)
    m = np.asarray(mask.sel(**box).values)
    if v.size == 0:
        raise RuntimeError(f"empty box at {lat},{lon}: check lat/lon ordering of the source")
    valid = np.isfinite(v) & (m == OPEN_SEA)
    cov = float(valid.mean())
    ok = cov >= MIN_COVERAGE
    vals = v[valid] - 273.15
    return {
        "sstC": round(float(vals.mean()), 3) if ok else None,
        "spatialStdC": round(float(vals.std()), 3) if ok else None,
        "isValid": ok,
        "coverage": round(cov, 3),
        "nCells": int(v.size),
    }


def earthdata_login() -> None:
    import earthaccess

    try:
        if os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD"):
            auth = earthaccess.login(strategy="environment")
        else:
            auth = earthaccess.login(strategy="netrc")
    except Exception as e:  # earthaccess raises when no netrc exists
        log(f"earthaccess login error: {type(e).__name__}")
        auth = None
    if not auth or not getattr(auth, "authenticated", False):
        raise SystemExit(
            "Earthdata Login failed. Set EARTHDATA_USERNAME/EARTHDATA_PASSWORD or add\n"
            "  machine urs.earthdata.nasa.gov login <user> password <pass>\nto ~/.netrc (chmod 600). "
            "Free account: https://urs.earthdata.nasa.gov/users/new"
        )


def check_units(sst) -> None:
    """Spec §5.4: convert according to the variable metadata, never by assumption."""
    units = str(sst.attrs.get("units", "")).lower()
    if units not in ("kelvin", "k"):
        raise SystemExit(f"analysed_sst units are {units!r}, expected kelvin; refusing to convert")


# Physically possible open-ocean SST in °C (sea water freezes near −1.9 °C). Anything outside means a decoding bug.
SST_PLAUSIBLE_C = (-2.5, 36.0)


def sanity_check(frames: list[dict], locations: list[dict]) -> None:
    """Refuse to write a manifest whose measured values are impossible; print a summary for a human check."""
    problems = []
    log("\nMeasured SST summary (°C):  location        min     max   valid  first-frame deltaC")
    for loc in locations:
        pts = [f["points"][loc["id"]] for f in frames]
        vals = [p["sstC"] for p in pts if p["isValid"]]
        for f, p in zip(frames, pts):
            if p["isValid"] and not SST_PLAUSIBLE_C[0] <= p["sstC"] <= SST_PLAUSIBLE_C[1]:
                problems.append(f"{loc['id']} {f['date']}: {p['sstC']} °C is outside {SST_PLAUSIBLE_C}")
            if not p["isValid"] and (p["sstC"] is not None or p["deltaC"] is not None):
                problems.append(f"{loc['id']} {f['date']}: invalid point carries a value")
        if pts[0]["deltaC"] is not None:
            problems.append(f"{loc['id']}: first frame must have deltaC = null")
        lo, hi = (min(vals), max(vals)) if vals else (None, None)
        log(f"  {loc['id']:<24} {lo!s:>7} {hi!s:>7}  {len(vals):>2}/{len(pts)}   {pts[0]['deltaC']}")
    if problems:
        raise SystemExit("Sanity check failed, manifest NOT written:\n  " + "\n  ".join(problems))


def earthdata_open(date: str):
    import earthaccess
    import xarray as xr

    found = earthaccess.search_data(short_name=MUR_SHORT_NAME, temporal=(f"{date}T00:00:00Z", f"{date}T23:59:59Z"))
    stamp = date.replace("-", "")
    found = [g for g in found if any(stamp in u for u in g.data_links())]
    if not found:
        raise SystemExit(f"No MUR granule found for {date}")
    g = found[0]
    url = next(u for u in g.data_links() if stamp in u)
    f = earthaccess.open([g])[0]
    ds = xr.open_dataset(f, engine="h5netcdf")
    return ds.isel(time=0), url


def zarr_open(date: str):
    import xarray as xr

    ds = xr.open_zarr(AWS_ZARR, storage_options={"anon": True}, consolidated=True)
    return ds.sel(time=f"{date}T09:00:00"), f"{AWS_ZARR} (time={date}T09:00Z)"


# ----------------------------------------------------------------------------- main
def selftest(date: str, locations: list[dict]) -> None:
    log(f"Self-test: extracting presets from the anonymous AWS MUR Zarr for {date} …")
    ds, src = zarr_open(date)
    check_units(ds.analysed_sst)
    print(f"source: {src}\nunits: {ds.analysed_sst.attrs.get('units')}  lat order: {float(ds.lat[0])}→{float(ds.lat[-1])}")
    for loc in locations:
        p = extract_point(ds.analysed_sst, ds.mask, loc["lat"], loc["lon"])
        print(f"  {loc['id']:<7} {loc['lat']:>6}, {loc['lon']:>7}  sstC={p['sstC']}  σ={p['spatialStdC']}  cov={p['coverage']}  n={p['nCells']}")
    land = extract_point(ds.analysed_sst, ds.mask, 40.0, -100.0)  # Kansas: must be invalid
    print(f"  land check (40N 100W): isValid={land['isValid']} sstC={land['sstC']}")
    assert not land["isValid"], "land point should be invalid"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["measured", "visual"], default="measured")
    ap.add_argument("--dates", help="comma-separated YYYY-MM-DD observation dates")
    ap.add_argument("--monthly", nargs=2, metavar=("START", "END"), default=["2025-11", "2026-10"],
                    help="15th of each month, YYYY-MM … YYYY-MM (default 2025-11 2026-10)")
    ap.add_argument("--locations", default=str(ROOT / "scripts" / "locations.json"))
    ap.add_argument("--out", default=str(ROOT / "apps" / "web" / "public" / "data" / "sst"))
    ap.add_argument("--cache", default=str(ROOT / "scripts" / ".cache"))
    ap.add_argument("--selftest", metavar="DATE", help="validate extraction against AWS MUR Zarr (≤ 2019) and exit")
    a = ap.parse_args()

    locations = json.loads(Path(a.locations).read_text())
    if a.selftest:
        selftest(a.selftest, locations)
        return

    dates = sorted(a.dates.split(",")) if a.dates else monthly_dates(*a.monthly)
    if not 8 <= len(dates) <= 24:
        raise SystemExit(f"Spec requires 8–24 frames; got {len(dates)}")
    available = svs_available_dates()
    missing = [d for d in dates if d not in available]
    if missing:
        raise SystemExit(f"SVS 5101 has no frame for: {', '.join(missing)} (available {min(available)} … {max(available)})")

    if a.mode == "measured":
        earthdata_login()  # fail fast, before any frame is overwritten

    out, cache = Path(a.out), Path(a.cache)
    (out / "frames").mkdir(parents=True, exist_ok=True)

    api = read_json(SVS_API)
    keywords = [k.get("name") if isinstance(k, dict) else k for k in api.get("keywords") or []]
    scale = colorbar_stops(fetch(SVS_COLORBAR, cache / "svs" / "colorbar.jpg"))

    frames = []
    prev: dict | None = None
    for i, date in enumerate(dates):
        log(f"[{i + 1}/{len(dates)}] {date}")
        exr = fetch(svs_frame_url(date), cache / "svs" / f"sst_mur_{date.replace('-', '')}_no-dates.exr")
        img = exr_to_srgb(exr)
        name = f"sst_{date.replace('-', '')}_merc.jpg"
        Image.fromarray(equirect_to_mercator(img)).save(out / "frames" / name, quality=84, optimize=True, progressive=True)

        if a.mode == "measured":
            ds, numeric_src = earthdata_open(date)
            sst, mask = ds.analysed_sst, ds.mask
            check_units(sst)
        points = {}
        for loc in locations:
            base = {"lat": loc["lat"], "lon": loc["lon"]}
            if a.mode == "measured":
                p = {**base, **extract_point(sst, mask, loc["lat"], loc["lon"])}
                before = prev["points"][loc["id"]] if prev else None
                p["deltaC"] = (round(p["sstC"] - before["sstC"], 3)
                               if before and p["isValid"] and before["isValid"] else None)
            else:
                p = {**base, "sstC": None, "deltaC": None, "spatialStdC": None, **visual_feature(img, loc["lat"], loc["lon"])}
                before = prev["points"][loc["id"]] if prev else None
                p["featureDelta"] = (round(p["feature"] - before["feature"], 4)
                                     if before and p["isValid"] and before["isValid"] else None)
            points[loc["id"]] = p

        days = (dt.date.fromisoformat(date) - dt.date.fromisoformat(prev["date"])).days if prev else None
        frame = {
            "frameId": f"sst-{date.replace('-', '')}",
            "date": date,
            "imageUrl": f"data/sst/frames/{name}",
            "sourceUrl": svs_frame_url(date),
            "datasetId": MUR_SHORT_NAME,
            "daysSincePrevious": days,
            "points": points,
        }
        if a.mode == "measured":
            frame["numericSourceUrl"] = numeric_src
        frames.append(frame)
        prev = frame
        if a.mode == "measured":
            ds.close()

    if a.mode == "measured":
        sanity_check(frames, locations)

    manifest = {
        "schemaVersion": 1,
        "title": "Ocean Surface Temperature",
        "datasetId": MUR_SHORT_NAME,
        "dataMode": "measured_sst" if a.mode == "measured" else "visual_feature",
        "units": "degC" if a.mode == "measured" else "red_blue_index",
        "samplingMethod": SAMPLING_MEASURED if a.mode == "measured" else SAMPLING_VISUAL,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "generator": "scripts/prepare_data.py",
        "visualization": {
            "svsId": SVS_ID,
            "title": api.get("title"),
            "url": SVS_PAGE,
            "eicKeyword": "Earth Information Center" in keywords,
            "frameSet": SVS_FRAMES,
            "projection": "Source frames are equirectangular 4096×2048; reprojected row-exactly to Web Mercator (±85.0511°) for display.",
            "credit": "NASA's Scientific Visualization Studio",
        },
        "numericSource": None if a.mode == "visual" else {
            "name": "GHRSST Level 4 MUR Global Foundation Sea Surface Temperature Analysis v4.1",
            "shortName": MUR_SHORT_NAME, "url": MUR_PAGE, "doi": MUR_DOI,
            "credit": "NASA JPL / PO.DAAC", "variable": "analysed_sst (kelvin)",
        },
        "colorScale": scale,
        "locations": locations,
        "frames": frames,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    log(f"Wrote {out / 'manifest.json'} ({manifest['dataMode']}, {len(frames)} frames)")


if __name__ == "__main__":
    main()
