# Flood Map

Type an address, get the real ~2×2 km terrain around it as a 3D surface, then
pour heavy rain on it and watch — with a mass-conserving 2-D flow model — where
the water flows, pools, and floods. It is an **educational, real-time rainfall-
flood _visualization_, not an engineering flood study**: a non-inertial
virtual-pipes (diffusive-wave) approximation to the shallow-water equations over a
bare-earth DEM (FABDEM) with OSM buildings/roads, simplified storm-drain &
infiltration loss terms, and rainfall hyetographs. Parameters are literature-
typical defaults, **uncalibrated** to any gauged event — indicative, not a
flood-risk assessment. See **Limitations** below.

![concept](https://img.shields.io/badge/three.js-GPU%20virtual--pipes-2f6feb)

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
- **Physics-based flow model.** A **non-inertial virtual-pipes (diffusive-wave)
  model** (after O'Brien/Julien; Mei, Decaudin & Hu, 2007) runs entirely on the
  GPU via `GPUComputationRenderer`: rainfall → inter-cell flux (driven by the
  water-surface head gradient) → water-depth update → diagnostic velocity, with
  simplified infiltration, evaporation, drainage, open/closed boundaries and a
  volume-capped flux that conserves water exactly. It is an approximation of the
  shallow-water (Saint-Venant) equations that **omits flow momentum/inertia** —
  the friction term is a numerical flow-relaxation factor, not Manning's _n_.
- **Everything is parameterized** live: rain intensity, storm-cell footprint,
  infiltration, evaporation, gravity, flow coefficient, friction, time scale,
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

Each grid cell holds terrain height `b`, water depth `d`, four outflow fluxes
`(L,R,T,B)` and a velocity. Per sub-step:

1. **Flux** — `f_i = max(0, Δt·g·A/l·Δh_i)` toward each lower neighbor — note it is
   **recomputed from the water-surface head gradient `Δh` each step** (no stored
   discharge `f_old`, hence non-inertial / no momentum) — then scaled by
   `K = min(1, d·cell²/(Σf·Δt))` so a cell never drains more water than it holds.
2. **Depth** — `Δd = Δt·(inflow − outflow)/cell²`, plus rain, minus infiltration,
   drainage and evaporation (all simplified loss terms — see Limitations).
3. **Velocity** — *diagnosed* from the net flux, for flow arrows and ripples.

Sub-step size is CFL-bounded (`Δt ≤ 0.45·Δx/√(g·h)`, the gravity-wave Courant
condition). With losses at zero and **closed** edges, the *water stored* stat
tracks *rain in* — a mass-conservation sanity check (unit-tested in
`virtualPipes.test.ts`).

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

- **Non-inertial flow.** The virtual-pipes / diffusive-wave scheme omits flow
  momentum/inertia (the `∂Q/∂t` term of the full shallow-water equations), so it
  cannot reproduce overshoot, oscillation or hydraulic jumps. Friction is a
  numerical flow-relaxation factor, **not Manning's _n_**.
- **Simplified losses.** Infiltration is a constant per-class capacity (a
  φ-index, not Green-Ampt/Horton/SCS-CN); the storm sewer is a uniform per-cell
  removal rate, **not a routed pipe network** — so sewer surcharge and downstream
  resurfacing (the dominant urban-pluvial mechanism) are not represented.
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
