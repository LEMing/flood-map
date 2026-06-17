import * as THREE from 'three';
import { SOURCE_LABELS, type Params } from '../config';
import type { Heightmap } from '../geo/heightmap';
import { loadTerrainInWorker } from '../geo/loadInWorker';
import { geocode, type GeocodeResult } from '../geo/geocode';
import { fetchSatellite } from '../geo/satelliteTiles';
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
import { GeologyController } from './GeologyController';
import { MarkerLayer } from './MarkerLayer';
import { SimDriver } from './SimDriver';
import { showToast } from '../ui/toast';
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

  constructor(private readonly host: WorldBuilderHost) {}

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
    showToast(t('toast.loadingPlace', { q: place }), false, 0);
    try {
      const N = this.host.params.gridResolution;
      // DEM fetch/decode/inpaint + ocean bathymetry + OSM rasterize + surface
      // fields all run off the main thread; the meshes are built here (WebGL).
      const { heightmap, warning, sourceUsed, surface } = await loadTerrainInWorker({
        location,
        mapSizeKm: this.host.params.mapSizeKm,
        N,
        elevationSource: this.host.params.elevationSource,
        useSurface: this.host.params.useSurface,
        params: this.host.params,
      });

      this.build(heightmap, surface);
      this.host.setStatsLocation(location.displayName.split(',').slice(0, 3).join(','));
      writeUrlState({
        lat: location.lat, lon: location.lon,
        km: this.host.params.mapSizeKm, grid: this.host.params.gridResolution,
      });
      this.host.addressBar.setValue(displayLabel(location));
      this.host.refreshPanel();
      const surfNote = surface ? ` · ${surface.counts.buildings} bld / ${surface.counts.roads} roads` : '';
      showToast(
        warning ?? `${t('toast.loaded', { place })} — ${heightmap.min.toFixed(0)}–${heightmap.max.toFixed(0)} m (${SOURCE_LABELS[sourceUsed]})${surfNote}`,
        !!warning,
      );
      trackEvent('location_loaded', { place, source: sourceUsed, size_km: this.host.params.mapSizeKm });
    } catch (err) {
      showToast((err as Error).message, true);
    } finally {
      this.loading = false;
      this.host.addressBar.setBusy(false);
    }
  }

  private build(heightmap: Heightmap, surface: SurfaceResult | null): void {
    this.host.disposeWorld();
    this.buildToken++;
    const world = this.construct(heightmap, surface);
    this.host.setBuiltWorld(world);
    this.host.applyParams();
    const midHeight = ((heightmap.min + heightmap.max) / 2) * this.host.params.verticalExaggeration;
    this.host.scene.fitToTerrain(heightmap.sizeMeters, midHeight);
    this.loadSatellite(this.buildToken, heightmap);
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

    return { heightmap, terrain, water, sea, floodOverlay, maxFlood, velocity, rain, surfaceTexture, surfaceRaw };
  }

  private loadSatellite(token: number, hm: Heightmap): void {
    fetchSatellite(hm.center, hm.sizeMeters, hm.N)
      .then(({ texture, uvSat }) => {
        const terrain = this.host.getTerrain();
        if (token !== this.buildToken || !terrain) {
          texture.dispose();
          return;
        }
        terrain.setSatellite(texture, uvSat);
        this.host.applyParams();
      })
      .catch((err) => {
        if (token !== this.buildToken) return;
        if (this.host.params.terrainStyle === 'satellite') {
          showToast(`Satellite imagery unavailable (${(err as Error).message}). Showing elevation tint.`, true);
        }
      });
  }
}

function displayLabel(location: GeocodeResult): string {
  if (parseCoords(location.displayName)) return location.displayName;
  return location.displayName.split(',').slice(0, 2).map((s) => s.trim()).join(', ');
}
