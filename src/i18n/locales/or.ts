// English is the source catalog. Other locales mirror these keys; any missing
// key falls back to English. Keep {placeholders}, emoji and units unchanged
// when translating.
export const or: Record<string, string> = {
  // Address bar
  'input.placeholder': 'ଠିକଣା, ସ୍ଥାନ, କିମ୍ବା "lat, lon"…',
  'btn.load': 'ଲୋଡ୍ କରନ୍ତୁ',
  'btn.loading': 'ଲୋଡ୍ ହେଉଛି…',
  'autocomplete.useCoords': 'ସ୍ଥାନାଙ୍କ {coords} ବ୍ୟବହାର କରନ୍ତୁ',

  // Panel + folders
  'panel.title': 'ବନ୍ୟା ମାନଚିତ୍ର',
  'sim.title': 'ସିମୁଲେସନ୍',
  'rain.title': 'ବର୍ଷା',
  'urban.title': 'ସହରୀ ମଡେଲ୍',
  'soil.title': 'ମାଟି ଓ ବାଷ୍ପୀଭବନ',
  'physics.title': 'ପଦାର୍ଥ ବିଜ୍ଞାନ',
  'map.title': 'ମାନଚିତ୍ର (ପୁନଃଲୋଡ୍)',
  'viz.title': 'ଭିଜୁଆଲାଇଜେସନ୍',
  'stats.title': 'ପରିସଂଖ୍ୟାନ',

  // Simulation
  'sim.play': 'ଚଲାନ୍ତୁ ▶',
  'sim.pause': 'ବିରତି ⏸',
  'sim.step': 'ପଦକ୍ଷେପ ⏭',
  'sim.reset': 'ରିସେଟ୍ ⟳',
  'sim.dump': 'ଜଳ ଛାଡ଼ନ୍ତୁ 💧 (ଆକସ୍ମିକ ବନ୍ୟା)',
  'sim.fill': 'ସ୍ତର ପର୍ଯ୍ୟନ୍ତ ପୂରଣ 🌊 (ଏକ-ଥର)',
  'sim.dumpDepth': 'ଛାଡ଼ିବା ଗଭୀରତା (m)',
  'sim.floodLevel': 'ବନ୍ୟା ସ୍ତର (+m)',
  'sim.liveFlood': 'ସିଧାସଳଖ ବନ୍ୟା ସ୍ତର',
  'sim.timescale': 'ସମୟ × (sim s/s)',
  'sim.substeps': 'ଉପ-ପଦକ୍ଷେପ',
  'pour.button': 'ଜଳ ଢାଳନ୍ତୁ',
  'pour.hint': 'ଜଳ ଢାଳିବାକୁ ମାନଚିତ୍ର ଉପରେ କ୍ଲିକ୍ କରନ୍ତୁ',
  'pour.depth': 'ଢାଳିବା ଗଭୀରତା (m)',
  'pour.radius': 'ଢାଳିବା ବ୍ୟାସାର୍ଦ୍ଧ (m)',

  // Rain
  'rain.raining': 'ବର୍ଷା ହେଉଛି',
  'rain.stormEvent': 'ଝଡ଼ ଘଟଣା',
  'rain.clouds': 'ମେଘ ⛈ + ବିଜୁଳି',
  'rain.constant': 'ସ୍ଥିର mm/hr',
  'rain.footprint': 'ବ୍ୟାପ୍ତି',
  'rain.footprintUniform': 'ସମାନ',
  'rain.footprintSpot': 'ଝଡ଼ କୋଷ',
  'rain.cellX': 'କୋଷ x',
  'rain.cellY': 'କୋଷ y',
  'rain.cellRadius': 'କୋଷ ବ୍ୟାସାର୍ଦ୍ଧ',

  // Storm hyetograph presets
  'storm.constant': 'ସ୍ଥିର (ମାନୁଆଲ୍ mm/hr)',
  'storm.cloudburst': 'ମେଘଭଙ୍ଗ (~50 mm / 2 h)',
  'storm.design25yr': 'ଡିଜାଇନ୍ ଝଡ଼ P≈25 yr',
  'storm.may2026': 'ପର୍ଯ୍ୟବେକ୍ଷିତ 18 May 2026 (41 mm/2 h)',
  'storm.jun2026': 'ପର୍ଯ୍ୟବେକ୍ଷିତ 12 Jun 2026 (90 mm/day)',

  // Urban model
  'urban.surface': 'ପୃଷ୍ଠ ମଡେଲ୍',
  'urban.buildings': 'କାନ୍ଥ ଭାବେ କୋଠା',
  'urban.sewer': 'ବର୍ଷା ନର୍ଦ୍ଦମା (mm/hr)',
  'urban.groundwater': 'ଉଚ୍ଚ ଭୂତଳ ଜଳ',

  // Soil
  'soil.infiltration': 'ମାଟି ଅନୁପ୍ରବେଶ (mm/hr)',
  'soil.evaporation': 'ବାଷ୍ପୀଭବନ (/hr)',

  // Physics
  'physics.gravity': 'ମାଧ୍ୟାକର୍ଷଣ (m/s²)',
  'physics.flow': 'ପ୍ରବାହ ଗୁଣାଙ୍କ',
  'physics.friction': 'ଘର୍ଷଣ',
  'physics.edges': 'କିନାରା',
  'physics.edgesOpen': 'ଖୋଲା (ନିଷ୍କାସନ)',
  'physics.edgesClosed': 'ବନ୍ଦ (କାନ୍ଥ)',

  // Map
  'map.elevation': 'ଉଚ୍ଚତା',
  'map.size': 'ଆକାର (km)',
  'map.grid': 'ଗ୍ରିଡ୍',
  'map.apply': 'ଆକାର / ଗ୍ରିଡ୍ ପ୍ରୟୋଗ କରନ୍ତୁ ⟲',
  'map.demoMode': 'ଡେମୋ ମୋଡ୍',

  // Demo mode (precomputed, scrubbable storm timeline)
  'demo.title': 'ଡେମୋ',
  'demo.precompute': 'ଝଡ଼ ପୂର୍ବ-ଗଣନା ⏳',
  'demo.statusLabel': 'ସ୍ଥିତି',
  'demo.timeline': 'ସମୟରେଖା',
  'demo.play': 'ସମୟରେଖା ଚଲାନ୍ତୁ ▶',
  'demo.live': 'ସିଧାସଳଖ ସିମ୍ ⟳',
  'demo.stComputing': 'ଗଣନା ହେଉଛି… {pct}%',
  'demo.stReady': 'ଦୃଶ୍ୟ ପ୍ରସ୍ତୁତ — ସମୟ ସ୍କ୍ରବ୍ କରନ୍ତୁ',
  'demo.stLive': 'ସିଧାସଳଖ',

  // Visualization
  'viz.terrain': 'ଭୂଭାଗ',
  'viz.terrainSatellite': 'ଉପଗ୍ରହ',
  'viz.terrainHypso': 'ଉଚ୍ଚତା ରଙ୍ଗ',
  'viz.terrainHeatmap': 'ଉଚ୍ଚତା ହିଟମ୍ୟାପ୍',
  'viz.terrainSurface': 'ପୃଷ୍ଠ (ବନ୍ୟା ବିପଦ)',
  'viz.darkening': 'ଗଭୀରତା ଅନୁଯାୟୀ କଳାଭ',
  'viz.vertical': 'ଭୂଲମ୍ବ ×',
  'viz.opacity': 'ଜଳ ଅସ୍ୱଚ୍ଛତା',
  'viz.depthMax': 'ଗଭୀରତା ରଙ୍ଗ ସର୍ବାଧିକ (m)',
  'viz.maxFlood': 'ସର୍ବାଧିକ ବନ୍ୟା ବ୍ୟାପ୍ତି',
  'viz.arrows': 'ପ୍ରବାହ ତୀର',
  'viz.wireframe': 'ୱାୟାରଫ୍ରେମ୍ ଭୂଭାଗ',
  'viz.language': 'ଭାଷା',
  'viz.waterQuality': 'ଜଳ ଗୁଣବତ୍ତା',
  'viz.qLow': 'କମ୍ (ଶୀଘ୍ର)',
  'viz.qMedium': 'ମଧ୍ୟମ',
  'viz.qHigh': 'ଉଚ୍ଚ (ସୁନ୍ଦର)',
  'viz.reflections': 'ଆକାଶ ପ୍ରତିଫଳନ',
  'viz.refraction': 'ପ୍ରତିସରଣ',
  'viz.clarity': 'ଜଳ ସ୍ୱଚ୍ଛତା',
  'viz.ripples': 'ତରଙ୍ଗ ଶକ୍ତି',
  'viz.flowSpeed': 'ପ୍ରବାହ ବେଗ',
  'viz.foam': 'ଫେଣ',
  'viz.glint': 'ସୂର୍ଯ୍ୟ ଝଲକ',
  'viz.shoreline': 'କୂଳ କୋମଳତା (m)',
  'viz.skirt': 'କିନାରା ସ୍କର୍ଟ କାନ୍ଥ',
  'viz.floodOverlay': 'ବନ୍ୟା ମାନଚିତ୍ର ଓଭରଲେ',
  'viz.floodGrid': 'ବନ୍ୟା ଗ୍ରିଡ୍',

  // Atmosphere / post-processing
  'atmo.title': 'ବାୟୁମଣ୍ଡଳ',
  'atmo.post': 'ପୋଷ୍ଟ-ପ୍ରୋସେସିଂ',
  'atmo.exposure': 'ଏକ୍ସପୋଜର୍',
  'atmo.bloom': 'ବ୍ଲୁମ୍',
  'atmo.ssao': 'ପରିବେଶ ଅବରୋଧ',
  'atmo.vignette': 'ଭିନେଟ୍',
  'atmo.wetness': 'ଓଦା ଭୂମି (ବର୍ଷା)',
  'atmo.cloudShadows': 'ମେଘ ଛାୟା',
  'atmo.godRays': 'ଆଲୋକ ରଶ୍ମି (ଝଡ଼)',
  'atmo.haze': 'ଭୂତଳ କୁହୁଡ଼ି',
  'atmo.splashes': 'ବର୍ଷା ଛିଟା',
  'atmo.renderScale': 'ରେଣ୍ଡର୍ ସ୍କେଲ୍',
  'atmo.autoQuality': 'ସ୍ୱୟଂ ଗୁଣବତ୍ତା',

  // Stats
  'stats.location': 'ଅବସ୍ଥାନ',
  'stats.simTime': 'ସିମ୍ ସମୟ',
  'stats.rainIn': 'ବର୍ଷା ଭିତରେ',
  'stats.stored': 'ସଞ୍ଚିତ ଜଳ',
  'stats.flooded': 'ବନ୍ୟାକ୍ରାନ୍ତ କ୍ଷେତ୍ର',
  'stats.maxDepth': 'ସର୍ବାଧିକ ଗଭୀରତା',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': '“{q}” ଲୋଡ୍ ହେଉଛି…',
  'toast.loadingSurface': 'ପୃଷ୍ଠ ମଡେଲ୍ ଲୋଡ୍ ହେଉଛି (ଭୂମି ଆଚ୍ଛାଦନ + OSM)…',
  'toast.loaded': '{place} ଲୋଡ୍ ହେଲା',
  'toast.notFound': '“{q}” ପାଇଁ କୌଣସି ମେଳ ମିଳିଲା ନାହିଁ।',
  'toast.geocodeFail': 'ଜିଓକୋଡିଂ ବିଫଳ ହେଲା। କିଛି ସମୟ ପରେ ପୁଣି ଚେଷ୍ଟା କରନ୍ତୁ।',
  'toast.enterAddress': 'ଦୟାକରି ଏକ ଠିକଣା ପ୍ରବେଶ କରନ୍ତୁ।',
  'toast.autoQuality': 'ସୁଗମ ରଖିବାକୁ ଗ୍ରାଫିକ୍ସ ଗୁଣବତ୍ତା କମାଇଲା।',
  'toast.detecting': 'ଆପଣଙ୍କ ଅବସ୍ଥାନ ଚିହ୍ନଟ ହେଉଛି…',

  // Misc
  'legend.elevation': 'ଉଚ୍ଚତା',
  'readout.elev': 'ଉଚ୍ଚତା',
  'readout.water': 'ଜଳ',
};
