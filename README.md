# Flood Map

Type an address, get the real ~2×2 km terrain around it as a 3D surface, then
pour heavy rain on it and watch — with a mass-conserving 2-D flow model — where
the water flows, pools, and floods. It is an **educational, real-time rainfall-
flood _visualization_, not an engineering flood study**: the inertial
("local-acceleration") formulation of the 2-D shallow-water equations (Bates,
Horritt & Fewtrell, 2010 — the LISFLOOD-FP scheme) over a bare-earth DEM (FABDEM)
with OSM buildings/roads, simplified storm-drain & infiltration loss terms, and
rainfall hyetographs. Parameters are literature-typical defaults, **uncalibrated**
to any gauged event — indicative, not a flood-risk assessment. See **Limitations**
below.

![concept](https://img.shields.io/badge/three.js-GPU%20inertial%20shallow--water-2f6feb)

**Live:** https://krd-flood.web.app

## Deploy

Hosted on Firebase Hosting (site `krd-flood`, project `floodmap-krd-leming`),
deployed automatically by GitHub Actions:

- merge/push to **`main`** → live site (`krd-flood.web.app`)
- merge/push to **`develop`** → `develop` staging channel (`krd-flood--develop-*.web.app`)
- every **PR** → a temporary preview URL posted as a PR comment

Manual deploy: `npm run build && firebase deploy --only hosting`.

> The dev server proxies some data sources (see `vite.config.ts`). In the static
> production build those calls go direct (`src/geo/endpoints.ts`); the two
> sources without CORS (Copernicus GLO-30, ESA WorldCover) fall back to terrarium
> / OSM-only land use respectively.

## What it does

- **Address → terrain.** Geocodes the address (Nominatim / OpenStreetMap) and
  fetches elevation, building a metric heightmap on a local equidistant
  projection (proj4). Three switchable, key-free elevation sources:
  **Copernicus GLO-30** (default, accurate 30 m DSM, Cloud-Optimized GeoTIFF on
  AWS), **FABDEM** (GLO-30 with buildings/trees removed — bare-earth, best for
  flood routing, via the Hugging Face mirror), and **SRTM/terrarium** (AWS
  Terrain Tiles PNG) as a fallback.
- **3D surface.** A hill-shaded terrain mesh (three.js) you can drape with
  **real satellite imagery** (Esri World Imagery) or a hypsometric elevation
  tint — toggle in the Visualization panel. Imagery is draped through a second
  UV set so it never disturbs the simulation grid.
- **Physics-based flow model.** The **inertial shallow-water model** of Bates,
  Horritt & Fewtrell (2010) — the scheme behind LISFLOOD-FP — runs entirely on the
  GPU via `GPUComputationRenderer`: a per-face discharge carrying real momentum is
  evolved on a staggered grid (gravity forcing from the water-surface slope +
  semi-implicit Manning friction), then continuity updates depth. So a flood wave
  can **accelerate, overshoot and reverse**, not merely relax down the head
  gradient. A per-cell drainage limiter keeps depth ≥ 0 and conserves water
  exactly; the Manning _n_ is derived per-cell from the land-cover roughness.
- **Everything is parameterized** live: rain intensity, storm-cell footprint,
  infiltration, evaporation, gravity, friction (Manning roughness), time scale,
  substeps, map size, grid resolution, vertical exaggeration, and the
  visualization (water opacity, depth color scale, max-flood extent, flow
  arrows).

No API keys required — it runs on free, open data out of the box.

## Run

```bash
npm install
npm run dev
```

Open the printed local URL, type an address (try **"Boulder, Colorado"** or
**"Lynmouth, UK"** for dramatic relief), and hit **Load**. Rain starts
automatically; use the **Simulation** panel to Play/Pause/Step/Reset and the
other folders to tune the storm and physics.

### Build

```bash
npm run build && npm run preview
```

> The dev server proxies the geocoder and tile sources (see `vite.config.ts`)
> to avoid browser CORS issues and to send the User-Agent Nominatim requires.
> A production deployment needs an equivalent proxy for the `/api/geocode` and
> `/api/tiles` paths.

## The physics, briefly

Cells hold terrain height `z` and water depth `h`; each cell's east and north
**faces** hold a discharge per unit width `q` (the stored momentum). Per sub-step
(CFL-limited by `Δt ≤ 0.7·Δx/(|v| + √(g·h))`):

1. **Momentum** — each face's discharge is evolved (Bates et al. 2010):
   `q_{t+Δt} = (q_t − g·hf·Δt·∂η/∂x) / (1 + g·Δt·n²·|q_t|/hf^{7/3})`, where
   `η = z + h` is the water surface, `hf` the flow depth at the face, and the
   `q_t` term is the **inertia** the old model lacked. Per-cell `n` from land cover.
2. **Limiter** — a per-cell `λ ∈ (0,1]` scales each face draining a cell so it can't
   lose more than it holds in one step (the inertial analogue of a volume cap),
   keeping depth ≥ 0 while conserving mass on the shared face.
3. **Depth** — continuity `Δh = −Δt·(∂qx/∂x + ∂qy/∂y)`, plus rain, minus
   infiltration, drainage and evaporation (simplified loss terms — see Limitations).
   Velocity is then *diagnosed* (`q/h`) for flow arrows and ripples.

Sub-step size is CFL-bounded (`Δt ≤ 0.7·Δx/(|v| + √(g·h))`, the velocity-aware
Courant condition for the inertial scheme). With losses at zero and **closed**
edges, the *water stored* stat tracks *rain in* — a mass-conservation sanity check
(the whole scheme is pinned by a CPU reference in `inertialFlow.test.ts`).

## Data sources

- Geocoding: [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) (OSM) — ~1 req/s.
- Elevation (switchable, no key):
  - [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) — default, COG on AWS, read with [geotiff.js](https://geotiffjs.github.io/geotiff.js/) range requests.
  - [FABDEM](https://research-information.bris.ac.uk/en/datasets/fabdem-v1-2/) (bare-earth, CC-BY-NC) — via the [Hugging Face mirror](https://huggingface.co/datasets/links-ads/fabdem-v12).
  - [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (SRTM/terrarium) — fallback.
- Satellite imagery: [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9)
  — imagery © Esri, Maxar, Earthstar Geographics & the GIS User Community.
  Routed through the `/api/sat` dev proxy.

## Limitations

This is an **educational visualization, not an engineering flood study**, and it
is **uncalibrated** (parameters are literature-typical defaults, not fitted to any
gauged event). Specifically:

- **Inertial, but still simplified shallow water.** The solver evolves stored
  momentum (the `∂q/∂t` term), so it captures acceleration and overshoot — but it
  is the _local-inertial_ approximation (Bates et al., 2010): it drops the
  convective-acceleration term `∂(q²/h)/∂x`, so it is most accurate for the
  sub-to-trans-critical sheet flow of urban pluvial flooding and does **not**
  resolve true hydraulic jumps or strongly supercritical shocks. Manning _n_ is
  literature-typical and **uncalibrated**.
- **Simplified losses.** Infiltration uses a per-cell **Green-Ampt** model (capacity
  declines as the soil wets up, → the saturated conductivity Ks), so dry pervious
  ground absorbs the early rain and then ponds — but Ks and the suction-deficit are
  literature-typical, not measured, and there is no soil drying/redistribution
  between storms. The storm sewer is a **synthetic** network: a per-cell capacity
  scaled by D8 flow-accumulation (contributing area, concentrated along streets/
  valleys), with sewer storage routed one cell downstream per step and **surcharge**
  — when an overwhelmed pipe fills, the excess resurfaces at the bottleneck, the
  dominant urban-pluvial mechanism. It is a heuristic prior, **not** a digitized pipe
  network with real diameters; capacity and coverage are uncalibrated, and DEM-based
  routing breaks down on very flat terrain.
- **Not modeled:** groundwater flow, river/coastal/fluvial flooding, building
  porosity (buildings are solid walls), sediment, and sub-grid features (curbs,
  individual inlets, culverts). Native DEM posting is ~30 m (FABDEM), upsampled to
  the grid — micro-topography that controls real ponding is sub-grid.
- **Storm presets** are representative rainfall *profiles* scaled to reported
  event totals — **not gauge records or validated flood reconstructions**.
  Reported depths and flooded areas are **indicative, not measurements**.

For real flood-risk work use calibrated tools (HEC-RAS 2D, SWMM, TUFLOW,
LISFLOOD-FP) with validated inputs. Do **not** use this for insurance, planning,
or life-safety decisions.
