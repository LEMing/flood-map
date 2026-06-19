import * as THREE from 'three';
import { SOURCE_LABELS, type Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { acquireWorld } from '../geo/worldDataCache';
import { geocode, shortLabel, type GeocodeResult } from '../geo/geocode';
import { fetchSatellite } from '../geo/satelliteTiles';
import { clearDownloadSink, setDownloadSink } from '../geo/cache';
import { readUrlState, writeUrlState, parseCoords, formatCoords } from '../url';
import { detectIpLocation } from '../geo/ipLocation';
import {
  t, getLanguage, hasExplicitLanguage, resolveSmartLanguage, type Lang,
} from '../i18n';
import type { SurfaceResult } from '../geo/surface';
import { trackEvent } from '../analytics';
import { FloodSimulation } from '../sim/FloodSimulation';
import { Timeline } from '../sim/Timeline';
import { Rain } from '../render/Rain';
import { SceneManager } from '../render/SceneManager';
import { TerrainMesh } from '../render/TerrainMesh';
import { WaterMesh } from '../render/WaterMesh';
import { MaxFloodOverlay, VelocityField } from '../render/overlays';
import { FloodOverlay } from '../render/FloodOverlay';
import { SeaMesh } from '../render/SeaMesh';
import { BuildingsMesh } from '../render/BuildingsMesh';
import { GeologyController } from './GeologyController';
import { MarkerLayer } from './MarkerLayer';
import { SimDriver } from './SimDriver';
import { showToast } from '../ui/toast';
import { LoadingPanel } from '../ui/LoadingPanel';
import { AddressBar } from '../ui/AddressBar';

/** The freshly constructed world objects handed back to the app to hold + render. */
export interface BuiltWorld {
  heightmap: Heightmap;
  terrain: TerrainMesh;
  water: WaterMesh;
  sea: SeaMesh;
  floodOverlay: FloodOverlay;
  maxFlood: MaxFloodOverlay;
  velocity: VelocityField;
  rain: Rain;
  buildings?: BuildingsMesh;
  surfaceTexture?: THREE.DataTexture;
  surfaceRaw?: Pick<SurfaceResult, 'land' | 'osm'>;
}

/** What the builder needs from the app to construct and install a world. */
export interface WorldBuilderHost {
  readonly scene: SceneManager;
  readonly group: THREE.Group;
  readonly params: Params;
  readonly addressBar: AddressBar;
  readonly simDriver: SimDriver;
  readonly geology: GeologyController;
  readonly markerLayer: MarkerLayer;
  disposeWorld(): void;
  /** Store the built objects as the live world (the app holds + renders them). */
  setBuiltWorld(world: BuiltWorld): void;
  getTerrain(): TerrainMesh | undefined;
  applyParams(): void;
  applyDetectedLanguage(lang: Lang): void | Promise<void>;
  refreshPanel(): void;
  setStatsLocation(label: string): void;
}

/**
 * Owns the "address/center → terrain + surface → 3D world" pipeline: geocoding,
 * IP bootstrap, DEM/surface fetch, mesh construction and the async satellite
 * overlay. Hands the built world back to the app, which holds, renders and
 * disposes it.
 */
export class WorldBuilder {
  private currentLocation?: GeocodeResult;
  private loading = false;
  private buildToken = 0;
  private readonly loadingUi = new LoadingPanel();

  constructor(private readonly host: WorldBuilderHost) {}

  /** True while a center is being fetched/built — the cinematic video defers its
   *  precompute until this clears so it never records a half-built world. */
  get isLoading(): boolean { return this.loading; }

  /**
   * Decide the initial center and UI language. Explicit URL state wins; whatever
   * the URL leaves open is filled in from a coarse IP lookup (location + a
   * smart default language), falling back to the built-in default location.
   */
  async bootstrap(): Promise<void> {
    const url = readUrlState();
    const haveUrlCenter = url.lat !== undefined && url.lon !== undefined;
    const langPinned = hasExplicitLanguage();

    const needIp = !(haveUrlCenter && langPinned);
    if (needIp && !haveUrlCenter) showToast(t('toast.detecting'), false, 0);
    const ip = needIp ? await detectIpLocation() : null;

    if (!langPinned) {
      const smart = resolveSmartLanguage(ip);
      if (smart !== getLanguage()) await this.host.applyDetectedLanguage(smart);
    }

    await this.loadInitialCenter(url, ip);
  }

  private async loadInitialCenter(
    url: ReturnType<typeof readUrlState>,
    ip: Awaited<ReturnType<typeof detectIpLocation>>,
  ): Promise<void> {
    if (url.lat !== undefined && url.lon !== undefined) {
      await this.loadCenter({
        lat: url.lat,
        lon: url.lon,
        displayName: formatCoords(url.lat, url.lon),
      });
    } else if (ip) {
      const displayName = ip.city
        ? [ip.city, ip.region].filter(Boolean).join(', ')
        : formatCoords(ip.lat, ip.lon);
      await this.loadCenter({ lat: ip.lat, lon: ip.lon, displayName });
    } else {
      await this.loadAddress(this.host.params.address);
    }
  }

  reloadCurrent(): void {
    if (this.currentLocation) void this.loadCenter(this.currentLocation);
  }

  async loadAddress(text: string): Promise<void> {
    if (this.loading) return;
    const coords = parseCoords(text);
    if (coords) {
      await this.loadCenter({ lat: coords.lat, lon: coords.lon, displayName: formatCoords(coords.lat, coords.lon) });
      return;
    }
    this.loading = true;
    this.host.addressBar.setBusy(true);
    let location: GeocodeResult | null = null;
    try {
      location = await geocode(text);
    } catch (err) {
      showToast((err as Error).message, true);
    }
    this.loading = false;
    this.host.addressBar.setBusy(false);
    if (location) await this.loadCenter(location);
  }

  /** Build the terrain + surface + sim for an already-resolved center. */
  async loadCenter(location: GeocodeResult): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.currentLocation = location;
    this.host.addressBar.setBusy(true);
    const place = location.displayName.split(',')[0];
    this.loadingUi.start(place);
    try {
      const N = this.host.params.gridResolution;
      // DEM fetch/decode/inpaint + ocean bathymetry + OSM rasterize + surface
      // fields all run off the main thread; the meshes are built here (WebGL).
      // acquireWorld reuses the landing's background prefetch when it matches.
      const { heightmap, warning, sourceUsed, surface } = await acquireWorld(
        {
          location,
          mapSizeKm: this.host.params.mapSizeKm,
          N,
          elevationSource: this.host.params.elevationSource,
          useSurface: this.host.params.useSurface,
          params: this.host.params,
        },
        (p) => { this.loadingUi.setStage(p.stage); this.loadingUi.addBytes(p.bytes); },
      );

      const token = this.build(heightmap, surface);
      this.host.setStatsLocation(location.displayName.split(',').slice(0, 3).join(','));
      writeUrlState({
        lat: location.lat, lon: location.lon,
        km: this.host.params.mapSizeKm, grid: this.host.params.gridResolution,
      });
      this.host.addressBar.setValue(shortLabel(location));
      this.host.refreshPanel();
      const osmBusy = !!surface?.osmFailed;
      const surfNote = surface && !osmBusy ? ` · ${surface.counts.buildings} bld / ${surface.counts.roads} roads` : '';
      const loaded = `${t('toast.loaded', { place })} — ${heightmap.min.toFixed(0)}–${heightmap.max.toFixed(0)} m (${SOURCE_LABELS[sourceUsed]})${surfNote}`;
      // Distinguish "this area has no buildings" from "the OSM mirrors were busy"
      // (the latter is retryable) instead of silently showing 0 buildings.
      const message = osmBusy ? t('toast.osmBusy', { place }) : (warning ?? loaded);
      trackEvent('location_loaded', { place, source: sourceUsed, size_km: this.host.params.mapSizeKm });
      // The terrain is on screen — the load is "done" (the finally frees the
      // address bar so a new location can load right away). Satellite is a
      // non-blocking enhancement: it pops in, drives the imagery stage, then
      // fades the card and surfaces the result toast.
      this.loadingUi.setStage('imagery');
      void this.loadSatellite(token, heightmap, message, !!warning || osmBusy);
    } catch (err) {
      this.loadingUi.fail();
      // A hung fetch is aborted by the cache's default deadline; surface that as a
      // friendly, retryable message rather than the raw "signal timed out".
      showToast(looksLikeTimeout(err) ? t('toast.loadTimeout') : (err as Error).message, true);
    } finally {
      this.loading = false;
      this.host.addressBar.setBusy(false);
    }
  }

  private build(heightmap: Heightmap, surface: SurfaceResult | null): number {
    this.host.disposeWorld();
    const token = ++this.buildToken;
    const world = this.construct(heightmap, surface);
    this.host.setBuiltWorld(world);
    this.host.applyParams();
    const midHeight = ((heightmap.min + heightmap.max) / 2) * this.host.params.verticalExaggeration;
    this.host.scene.fitToTerrain(heightmap.sizeMeters, midHeight);
    return token;
  }

  private construct(heightmap: Heightmap, surface: SurfaceResult | null): BuiltWorld {
    const { scene, group, params, simDriver } = this.host;
    const N = heightmap.N;

    let surfaceTexture: THREE.DataTexture | undefined;
    let surfaceRaw: Pick<SurfaceResult, 'land' | 'osm'> | undefined;
    if (surface) {
      surfaceRaw = { land: surface.land, osm: surface.osm };
      surfaceTexture = new THREE.DataTexture(surface.surface, N, N, THREE.RGBAFormat, THREE.FloatType);
      surfaceTexture.minFilter = THREE.NearestFilter;
      surfaceTexture.magFilter = THREE.NearestFilter;
      surfaceTexture.needsUpdate = true;
    }

    const terrain = new TerrainMesh(heightmap, params.wireframe);
    terrain.setWeatherUniforms(scene.weather);
    const sim = new FloodSimulation(scene.renderer, terrain.heightTexture, N, heightmap.sizeMeters, params);
    simDriver.setWorld(sim, new Timeline(N), heightmap);
    simDriver.setSurface(params.useSurface && surfaceTexture ? surfaceTexture : null);
    if (surface) terrain.setSurfaceColors(surface.surface, N);
    const water = new WaterMesh(
      terrain.geometry, terrain.heightTexture, heightmap.min, N, heightmap.sizeMeters, params,
    );
    water.setWeatherUniforms(scene.weather);
    const sea = new SeaMesh(terrain.geometry, heightmap, surface?.land ?? null, params);
    sea.setWeatherUniforms(scene.weather);
    const floodOverlay = new FloodOverlay(terrain.geometry, terrain.heightTexture, N, heightmap.sizeMeters, params);
    const maxFlood = new MaxFloodOverlay(terrain.geometry);
    const velocity = new VelocityField(heightmap.sizeMeters, terrain.heightTexture);
    const rain = new Rain(heightmap);

    const buildings = this.buildBuildings(surface, group);

    group.add(
      terrain.mesh, sea.mesh, water.mesh, water.skirt, floodOverlay.mesh,
      maxFlood.mesh, velocity.mesh, rain.object,
    );
    // The geology block lives in world space (not the terrain group) so its deep
    // vertical scale is independent of the terrain's exaggeration.
    const geologyMesh = this.host.geology.build(heightmap, surface?.land ?? null).mesh;
    scene.scene.add(geologyMesh);
    // Keep above-water overlays (and the opaque geology block below) out of the
    // refraction source so they don't get baked under the water surface.
    scene.setRefractionExcludes([floodOverlay.mesh, maxFlood.mesh, velocity.mesh, rain.object, geologyMesh]);
    this.host.markerLayer.build(heightmap);

    return {
      heightmap, terrain, water, sea, floodOverlay, maxFlood, velocity, rain, buildings,
      surfaceTexture, surfaceRaw,
    };
  }

  /** Render the worker-extruded OSM footprints as 3D massing. Built whenever
   *  footprints exist; the `buildings3D` param just toggles visibility. */
  private buildBuildings(surface: SurfaceResult | null, group: THREE.Group): BuildingsMesh | undefined {
    const geometry = surface?.buildingGeometry;
    if (!geometry || geometry.position.length === 0) return undefined;
    const { params } = this.host;
    const mesh = new BuildingsMesh(geometry);
    mesh.setVisible(params.buildings3D);
    mesh.setVerticalExaggeration(params.verticalExaggeration);
    group.add(mesh.mesh);
    return mesh;
  }

  /** Background: fetch the satellite overlay, drive the imagery stage + its byte
   *  count, then fade the card and surface the result toast. Token-guarded so a
   *  newer load (which owns the card now) is never clobbered by a stale fetch. */
  private async loadSatellite(
    token: number,
    hm: Heightmap,
    message: string,
    isWarning: boolean,
  ): Promise<void> {
    const sink = (bytes: number) => this.loadingUi.addBytes(bytes);
    setDownloadSink(sink);
    let toastMessage = message;
    let toastIsError = isWarning;
    try {
      const { texture, uvSat } = await fetchSatellite(hm.center, hm.sizeMeters, hm.N);
      const terrain = this.host.getTerrain();
      if (token === this.buildToken && terrain) {
        terrain.setSatellite(texture, uvSat);
        this.host.applyParams();
      } else {
        texture.dispose();
      }
    } catch (err) {
      if (token === this.buildToken && this.host.params.terrainStyle === 'satellite') {
        toastMessage = `Satellite imagery unavailable (${(err as Error).message}). Showing elevation tint.`;
        toastIsError = true;
      }
    } finally {
      clearDownloadSink(sink);
      if (token === this.buildToken) {
        this.loadingUi.done();
        showToast(toastMessage, toastIsError);
      }
    }
  }
}

// A hung fetch is aborted by cache.ts's default deadline (AbortSignal.timeout),
// which rejects the worker's own promise chain cleanly — no racing/orphaning here.
// The aborted fetch surfaces as a timeout/abort error; recognise it so the catch
// can show the localized retry message instead of "signal timed out".
function looksLikeTimeout(err: unknown): boolean {
  return /tim(e|ed) ?out|abort/i.test((err as Error)?.message ?? '');
}
