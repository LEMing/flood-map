export const hi: Record<string, string> = {
  // Address bar
  'input.placeholder': 'पता, स्थान, या "अक्षांश, देशांतर"…',
  'btn.load': 'लोड करें',
  'btn.loading': 'लोड हो रहा है…',
  'autocomplete.useCoords': 'निर्देशांक {coords} उपयोग करें',

  // Panel + folders
  'panel.title': 'बाढ़ मानचित्र',
  'sim.title': 'सिमुलेशन',
  'rain.title': 'वर्षा',
  'urban.title': 'शहरी मॉडल',
  'soil.title': 'मृदा एवं वाष्पीकरण',
  'physics.title': 'भौतिकी',
  'map.title': 'मानचित्र (पुनः लोड)',
  'viz.title': 'विज़ुअलाइज़ेशन',
  'stats.title': 'आँकड़े',

  // Simulation
  'sim.play': 'चलाएँ ▶',
  'sim.pause': 'रोकें ⏸',
  'sim.step': 'चरण ⏭',
  'sim.reset': 'रीसेट ⟳',
  'sim.dump': 'जल छोड़ें 💧 (अचानक बाढ़)',
  'sim.fill': 'स्तर तक भरें 🌊 (एक-बार)',
  'sim.dumpDepth': 'छोड़ने की गहराई (m)',
  'sim.floodLevel': 'बाढ़ स्तर (+m)',
  'sim.liveFlood': 'लाइव बाढ़ स्तर',
  'sim.timescale': 'समय × (सिम सेकंड/सेकंड)',
  'sim.substeps': 'उप-चरण',
  'pour.button': 'जल उँडेलें',
  'pour.hint': 'जल उँडेलने के लिए मानचित्र पर क्लिक करें',
  'pour.depth': 'उँडेलने की गहराई (m)',
  'pour.radius': 'उँडेलने की त्रिज्या (m)',

  // Rain
  'rain.raining': 'वर्षा हो रही है',
  'rain.stormEvent': 'तूफान घटना',
  'rain.clouds': 'बादल ⛈ + बिजली',
  'rain.constant': 'स्थिर mm/hr',
  'rain.footprint': 'प्रभाव क्षेत्र',
  'rain.footprintUniform': 'एकसमान',
  'rain.footprintSpot': 'तूफान कोशिका',
  'rain.cellX': 'सेल x',
  'rain.cellY': 'सेल y',
  'rain.cellRadius': 'सेल त्रिज्या',

  // Storm hyetograph presets
  'storm.constant': 'स्थिर (मैन्युअल mm/घंटा)',
  'storm.cloudburst': 'मूसलाधार वर्षा (~50 mm / 2 घंटा)',
  'storm.design25yr': 'डिज़ाइन तूफान P≈25 वर्ष',
  'storm.may2026': 'प्रेक्षित 18 मई 2026 (41 mm/2 घंटा)',
  'storm.jun2026': 'प्रेक्षित 12 जून 2026 (90 mm/दिन)',

  // Urban model
  'urban.surface': 'सतह मॉडल',
  'urban.buildings': 'भवन दीवारों के रूप में',
  'urban.sewer': 'वर्षा जल नाली (mm/hr)',
  'urban.groundwater': 'उच्च भूजल स्तर',

  // Soil
  'soil.infiltration': 'मृदा अंतःस्यंदन (mm/hr)',
  'soil.evaporation': 'वाष्पीकरण (/hr)',

  // Physics
  'physics.gravity': 'गुरुत्वाकर्षण (m/s²)',
  'physics.flow': 'प्रवाह गुणांक',
  'physics.friction': 'घर्षण',
  'physics.edges': 'किनारे',
  'physics.edgesOpen': 'खुला (निकासी)',
  'physics.edgesClosed': 'बंद (दीवारें)',

  // Map
  'map.elevation': 'ऊँचाई',
  'map.size': 'आकार (km)',
  'map.grid': 'ग्रिड',
  'map.apply': 'आकार / ग्रिड लागू करें ⟲',
  'map.demoMode': 'डेमो मोड',

  // Demo mode (precomputed, scrubbable storm timeline)
  'demo.title': 'डेमो',
  'demo.precompute': 'तूफान पूर्व-गणना करें ⏳',
  'demo.statusLabel': 'स्थिति',
  'demo.timeline': 'समयरेखा',
  'demo.play': 'समयरेखा चलाएँ ▶',
  'demo.live': 'लाइव सिम ⟳',
  'demo.stComputing': 'गणना हो रही है… {pct}%',
  'demo.stReady': 'दृश्य तैयार — समय खींचें',
  'demo.stLive': 'लाइव',

  // Visualization
  'viz.terrain': 'भूभाग',
  'viz.terrainSatellite': 'उपग्रह',
  'viz.terrainHypso': 'ऊँचाई रंग',
  'viz.terrainHeatmap': 'ऊँचाई हीटमैप',
  'viz.terrainSurface': 'सतह (बाढ़ जोखिम)',
  'viz.darkening': 'गहराई काला करना',
  'viz.vertical': 'ऊर्ध्वाधर ×',
  'viz.opacity': 'जल अपारदर्शिता',
  'viz.depthMax': 'गहराई रंग अधिकतम (m)',
  'viz.maxFlood': 'अधिकतम बाढ़ विस्तार',
  'viz.arrows': 'प्रवाह तीर',
  'viz.wireframe': 'वायरफ़्रेम भूभाग',
  'viz.language': 'भाषा',
  'viz.waterQuality': 'जल गुणवत्ता',
  'viz.qLow': 'निम्न (तेज़)',
  'viz.qMedium': 'मध्यम',
  'viz.qHigh': 'उच्च (सुंदर)',
  'viz.reflections': 'आकाश प्रतिबिंब',
  'viz.refraction': 'अपवर्तन',
  'viz.clarity': 'जल स्वच्छता',
  'viz.ripples': 'लहर तीव्रता',
  'viz.flowSpeed': 'प्रवाह गति',
  'viz.foam': 'झाग',
  'viz.glint': 'सूर्य चमक',
  'viz.shoreline': 'तट कोमलता (m)',
  'viz.skirt': 'किनारे की दीवारें',
  'viz.floodOverlay': 'बाढ़ मानचित्र ओवरले',
  'viz.floodGrid': 'बाढ़ ग्रिड',

  // Atmosphere / post-processing
  'atmo.title': 'वायुमंडल',
  'atmo.post': 'पोस्ट-प्रोसेसिंग',
  'atmo.exposure': 'एक्सपोज़र',
  'atmo.bloom': 'चमक (ब्लूम)',
  'atmo.ssao': 'परिवेशी अवरोधन',
  'atmo.vignette': 'विनेट',
  'atmo.wetness': 'गीली ज़मीन (वर्षा)',
  'atmo.cloudShadows': 'बादल छायाएँ',
  'atmo.godRays': 'प्रकाश किरणें (तूफान)',
  'atmo.haze': 'भू-धुंध',
  'atmo.splashes': 'वर्षा छींटे',
  'atmo.renderScale': 'रेंडर स्केल',
  'atmo.autoQuality': 'स्वतः गुणवत्ता',

  // Stats
  'stats.location': 'स्थान',
  'stats.simTime': 'सिम समय',
  'stats.rainIn': 'कुल वर्षा',
  'stats.stored': 'संग्रहित जल',
  'stats.flooded': 'बाढ़ क्षेत्र',
  'stats.maxDepth': 'अधिकतम गहराई',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': '"{q}" लोड हो रहा है…',
  'toast.loadingSurface': 'सतह मॉडल लोड हो रहा है (भूमि आवरण + OSM)…',
  'toast.loaded': '{place} लोड हुआ',
  'toast.notFound': '"{q}" के लिए कोई मिलान नहीं मिला।',
  'toast.geocodeFail': 'जियोकोडिंग विफल। कुछ क्षण बाद पुनः प्रयास करें।',
  'toast.enterAddress': 'कृपया एक पता दर्ज करें।',
  'toast.autoQuality': 'सहज बनाए रखने के लिए ग्राफ़िक्स गुणवत्ता घटाई गई।',
  'toast.detecting': 'आपका स्थान पता लगाया जा रहा है…',

  // Misc
  'legend.elevation': 'ऊँचाई',
  'readout.elev': 'ऊँचाई',
  'readout.water': 'जल',
};
