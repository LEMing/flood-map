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

  // Rain
  'rain.raining': 'वर्षा हो रही है',
  'rain.stormEvent': 'तूफान घटना',
  'rain.clouds': 'बादल ⛈ + बिजली',
  'rain.constant': 'स्थिर mm/hr',
  'rain.footprint': 'प्रभाव क्षेत्र',
  'rain.footprintUniform': 'एकसमान',
  'rain.footprintSpot': 'तूफान कोशिका',

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

  // Misc
  'legend.elevation': 'ऊँचाई',
  'readout.elev': 'ऊँचाई',
  'readout.water': 'जल',
};
