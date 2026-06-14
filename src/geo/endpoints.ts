// In dev we go through the Vite proxies (CORS + injected headers). A static
// production build (Firebase Hosting) has no proxy, so we call the sources
// directly. Nominatim / AWS terrain tiles / Esri imagery send `Access-Control-
// Allow-Origin: *`, so they work direct. Copernicus & ESA WorldCover S3 do NOT
// send CORS headers — in production those requests fail and the app falls back
// (terrarium for elevation, OSM-only for the surface model).
const PROD = import.meta.env.PROD;

export const ENDPOINTS = {
  geocode: PROD ? 'https://nominatim.openstreetmap.org' : '/api/geocode',
  tiles: PROD ? 'https://s3.amazonaws.com/elevation-tiles-prod' : '/api/tiles',
  sat: PROD
    ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile'
    : '/api/sat',
  cop30: PROD ? 'https://copernicus-dem-30m.s3.amazonaws.com' : '/api/cop30',
  worldcover: PROD ? 'https://esa-worldcover.s3.eu-central-1.amazonaws.com' : '/api/worldcover',
};
