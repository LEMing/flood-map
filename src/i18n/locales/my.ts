// English is the source catalog. Other locales mirror these keys; any missing
// key falls back to English. Keep {placeholders}, emoji and units unchanged
// when translating.
export const my: Record<string, string> = {
  // Address bar
  'input.placeholder': 'လိပ်စာ၊ နေရာ သို့မဟုတ် "lat, lon"…',
  'btn.load': 'ဖွင့်ရန်',
  'btn.loading': 'ဖွင့်နေသည်…',
  'autocomplete.useCoords': 'ကိုဩဒိနိတ် {coords} ကို သုံးရန်',

  // Panel + folders
  'panel.title': 'ရေကြီးမြေပုံ',
  'sim.title': 'ပုံတူစမ်းသပ်ခြင်း',
  'rain.title': 'မိုး',
  'urban.title': 'မြို့ပြပုံစံ',
  'soil.title': 'မြေဆီလွှာနှင့် အငွေ့ပျံခြင်း',
  'physics.title': 'ရူပဗေဒ',
  'map.title': 'မြေပုံ (ပြန်ဖွင့်)',
  'viz.title': 'မြင်ကွင်းဖော်ပြခြင်း',
  'stats.title': 'စာရင်းအင်း',

  // Simulation
  'sim.play': 'ဖွင့် ▶',
  'sim.pause': 'ခဏရပ် ⏸',
  'sim.step': 'အဆင့်ဆက် ⏭',
  'sim.reset': 'ပြန်စ ⟳',
  'sim.dump': 'ရေပုံချ 💧 (ရုတ်တရက်ရေကြီး)',
  'sim.fill': 'အဆင့်အထိ ဖြည့် 🌊 (တစ်ကြိမ်)',
  'sim.dumpDepth': 'ပုံချနက်ရှိုင်း (m)',
  'sim.floodLevel': 'ရေကြီးအဆင့် (+m)',
  'sim.liveFlood': 'တိုက်ရိုက်ရေကြီးအဆင့်',
  'sim.timescale': 'အချိန် × (sim s/s)',
  'sim.substeps': 'အဆင့်ခွဲများ',
  'pour.button': 'ရေလောင်း',
  'pour.hint': 'ရေလောင်းရန် မြေပုံပေါ်တွင် နှိပ်ပါ',
  'pour.depth': 'လောင်းနက်ရှိုင်း (m)',
  'pour.radius': 'လောင်းအချင်းဝက် (m)',

  // Rain
  'rain.raining': 'မိုးရွာနေသည်',
  'rain.stormEvent': 'မုန်တိုင်းဖြစ်ရပ်',
  'rain.clouds': 'တိမ်များ ⛈ + လျှပ်စီး',
  'rain.constant': 'အမြဲတမ်း mm/hr',
  'rain.footprint': 'လွှမ်းခြုံဧရိယာ',
  'rain.footprintUniform': 'ညီညာ',
  'rain.footprintSpot': 'မုန်တိုင်းဆဲလ်',
  'rain.cellX': 'ဆဲလ် x',
  'rain.cellY': 'ဆဲလ် y',
  'rain.cellRadius': 'ဆဲလ်အချင်းဝက်',

  // Storm hyetograph presets
  'storm.constant': 'အမြဲတမ်း (လက်ဖြင့် mm/hr)',
  'storm.cloudburst': 'မိုးသည်းထန် (~50 mm / 2 h)',
  'storm.design25yr': 'ဒီဇိုင်းမုန်တိုင်း P≈25 yr',
  'storm.may2026': 'မှတ်တမ်း 18 May 2026 (41 mm/2 h)',
  'storm.jun2026': 'မှတ်တမ်း 12 Jun 2026 (90 mm/day)',

  // Urban model
  'urban.surface': 'မျက်နှာပြင်ပုံစံ',
  'urban.buildings': 'အဆောက်အအုံများကို နံရံအဖြစ်',
  'urban.sewer': 'မိုးရေမြောင်း (mm/hr)',
  'urban.groundwater': 'မြေအောက်ရေ မြင့်',

  // Soil
  'soil.infiltration': 'မြေစိမ့်ဝင်မှု (mm/hr)',
  'soil.evaporation': 'အငွေ့ပျံ (/hr)',

  // Physics
  'physics.gravity': 'ဆွဲအား (m/s²)',
  'physics.flow': 'စီးဆင်းမှုကိန်း',
  'physics.friction': 'ပွတ်တိုက်အား',
  'physics.edges': 'အနားများ',
  'physics.edgesOpen': 'ဖွင့် (ရေထွက်)',
  'physics.edgesClosed': 'ပိတ် (နံရံ)',

  // Map
  'map.elevation': 'အမြင့်',
  'map.size': 'အရွယ်အစား (km)',
  'map.grid': 'ဂရစ်',
  'map.apply': 'အရွယ် / ဂရစ် သုံးရန် ⟲',
  'map.demoMode': 'သရုပ်ပြမုဒ်',

  // Demo mode (precomputed, scrubbable storm timeline)
  'demo.title': 'သရုပ်ပြ',
  'demo.precompute': 'မုန်တိုင်းကြိုတွက် ⏳',
  'demo.statusLabel': 'အခြေအနေ',
  'demo.timeline': 'အချိန်ဇယား',
  'demo.play': 'အချိန်ဇယားဖွင့် ▶',
  'demo.live': 'တိုက်ရိုက်စမ်းသပ် ⟳',
  'demo.stComputing': 'တွက်ချက်နေသည်… {pct}%',
  'demo.stReady': 'မြင်ကွင်းအဆင်သင့် — အချိန်ရွှေ့ပါ',
  'demo.stLive': 'တိုက်ရိုက်',

  // Visualization
  'viz.terrain': 'မြေမျက်နှာသွင်ပြင်',
  'viz.terrainSatellite': 'ဂြိုဟ်တု',
  'viz.terrainHypso': 'အမြင့်အလိုက်အရောင်',
  'viz.terrainHeatmap': 'အမြင့်အပူပြမြေပုံ',
  'viz.terrainSurface': 'မျက်နှာပြင် (ရေကြီးအန္တရာယ်)',
  'viz.darkening': 'နက်ရှိုင်းမှုအလိုက်မှောင်ခြင်း',
  'viz.vertical': 'ဒေါင်လိုက် ×',
  'viz.opacity': 'ရေအလင်းပိတ်မှု',
  'viz.depthMax': 'နက်ရှိုင်းအရောင်အမြင့်ဆုံး (m)',
  'viz.maxFlood': 'ရေကြီးအများဆုံးဧရိယာ',
  'viz.arrows': 'စီးဆင်းမြှားများ',
  'viz.wireframe': 'ဝါယာဘောင်မြေမျက်နှာပြင်',
  'viz.language': 'ဘာသာစကား',
  'viz.waterQuality': 'ရေအရည်အသွေး',
  'viz.qLow': 'နိမ့် (မြန်)',
  'viz.qMedium': 'အလယ်အလတ်',
  'viz.qHigh': 'မြင့် (လှ)',
  'viz.reflections': 'ကောင်းကင်ထင်ဟပ်ခြင်း',
  'viz.refraction': 'အလင်းကွေးခြင်း',
  'viz.clarity': 'ရေကြည်လင်မှု',
  'viz.ripples': 'လှိုင်းတွန့်အား',
  'viz.flowSpeed': 'စီးဆင်းနှုန်း',
  'viz.foam': 'ရေမြှုပ်',
  'viz.glint': 'နေရောင်တောက်ပြောင်',
  'viz.shoreline': 'ကမ်းခြေနူးညံ့မှု (m)',
  'viz.skirt': 'အနားကာနံရံများ',
  'viz.floodOverlay': 'ရေကြီးမြေပုံထပ်ပိုး',
  'viz.floodGrid': 'ရေကြီးဂရစ်',

  // Atmosphere / post-processing
  'atmo.title': 'လေထု',
  'atmo.post': 'နောက်ဆက်တွဲပြုပြင်ခြင်း',
  'atmo.exposure': 'အလင်းရရှိမှု',
  'atmo.bloom': 'အလင်းဖြာ',
  'atmo.ssao': 'ဝန်းကျင်အရိပ်ပိတ်ဆို့မှု',
  'atmo.vignette': 'အနားမှိန်',
  'atmo.wetness': 'မြေစို (မိုး)',
  'atmo.cloudShadows': 'တိမ်အရိပ်များ',
  'atmo.godRays': 'အလင်းတန်းများ (မုန်တိုင်း)',
  'atmo.haze': 'မြေပြင်မြူ',
  'atmo.splashes': 'မိုးရေစက်ကွဲ',
  'atmo.renderScale': 'ရန်ဒါစကေး',
  'atmo.autoQuality': 'အရည်အသွေးအလိုအလျောက်',

  // Stats
  'stats.location': 'တည်နေရာ',
  'stats.simTime': 'စမ်းသပ်ချိန်',
  'stats.rainIn': 'မိုးရွာသွင်း',
  'stats.stored': 'သိုလှောင်ရေ',
  'stats.flooded': 'ရေကြီးဧရိယာ',
  'stats.maxDepth': 'အနက်ဆုံး',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': '"{q}" ကို ဖွင့်နေသည်…',
  'toast.loadingSurface': 'မျက်နှာပြင်ပုံစံ ဖွင့်နေသည် (မြေဖုံး + OSM)…',
  'toast.loaded': '{place} ကို ဖွင့်ပြီး',
  'toast.notFound': '"{q}" အတွက် ကိုက်ညီမှုမတွေ့ပါ။',
  'toast.geocodeFail': 'ဂျီယိုကုဒ်ဖြည့်ခြင်း မအောင်မြင်ပါ။ ခဏနေ ပြန်ကြိုးစားပါ။',
  'toast.enterAddress': 'လိပ်စာ ထည့်ပါ။',
  'toast.autoQuality': 'ချောမွေ့စေရန် ဂရပ်ဖစ်အရည်အသွေးကို လျှော့လိုက်သည်။',
  'toast.detecting': 'သင့်တည်နေရာကို ရှာဖွေနေသည်…',

  // Misc
  'legend.elevation': 'အမြင့်',
  'readout.elev': 'အမြင့်',
  'readout.water': 'ရေ',
};
