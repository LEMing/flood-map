export const th: Record<string, string> = {
  // Address bar
  'input.placeholder': 'ที่อยู่ สถานที่ หรือ "ละติจูด, ลองจิจูด"…',
  'btn.load': 'โหลด',
  'btn.loading': 'กำลังโหลด…',
  'autocomplete.useCoords': 'ใช้พิกัด {coords}',

  // Panel + folders
  'panel.title': 'แผนที่น้ำท่วม',
  'sim.title': 'การจำลอง',
  'rain.title': 'ฝน',
  'urban.title': 'แบบจำลองเมือง',
  'soil.title': 'ดินและการระเหย',
  'physics.title': 'ฟิสิกส์',
  'map.title': 'แผนที่ (โหลดใหม่)',
  'viz.title': 'การแสดงผล',
  'stats.title': 'สถิติ',

  // Simulation
  'sim.play': 'เล่น ▶',
  'sim.pause': 'หยุดชั่วคราว ⏸',
  'sim.step': 'ทีละขั้น ⏭',
  'sim.reset': 'รีเซ็ต ⟳',
  'sim.dump': 'ปล่อยน้ำ 💧 (น้ำท่วมฉับพลัน)',
  'sim.fill': 'เติมถึงระดับ 🌊 (ครั้งเดียว)',
  'sim.dumpDepth': 'ความลึกการปล่อย (m)',
  'sim.floodLevel': 'ระดับน้ำท่วม (+m)',
  'sim.liveFlood': 'ระดับน้ำท่วมแบบสด',
  'sim.timescale': 'เวลา × (วินาทีจำลอง/วินาที)',
  'sim.substeps': 'ขั้นย่อย',

  // Rain
  'rain.raining': 'กำลังมีฝน',
  'rain.stormEvent': 'เหตุการณ์พายุ',
  'rain.clouds': 'เมฆ ⛈ + ฟ้าผ่า',
  'rain.constant': 'คงที่ mm/hr',
  'rain.footprint': 'ขอบเขตฝน',
  'rain.footprintUniform': 'สม่ำเสมอ',
  'rain.footprintSpot': 'เซลล์พายุ',

  // Urban model
  'urban.surface': 'แบบจำลองพื้นผิว',
  'urban.buildings': 'อาคารเป็นกำแพง',
  'urban.sewer': 'ท่อระบายน้ำฝน (mm/hr)',
  'urban.groundwater': 'น้ำใต้ดินสูง',

  // Soil
  'soil.infiltration': 'การซึมของดิน (mm/hr)',
  'soil.evaporation': 'การระเหย (/hr)',

  // Physics
  'physics.gravity': 'แรงโน้มถ่วง (m/s²)',
  'physics.flow': 'สัมประสิทธิ์การไหล',
  'physics.friction': 'แรงเสียดทาน',
  'physics.edges': 'ขอบ',
  'physics.edgesOpen': 'เปิด (ระบายน้ำ)',
  'physics.edgesClosed': 'ปิด (กำแพง)',

  // Map
  'map.elevation': 'ความสูง',
  'map.size': 'ขนาด (km)',
  'map.grid': 'กริด',
  'map.apply': 'ใช้ขนาด / กริด ⟲',

  // Visualization
  'viz.terrain': 'ภูมิประเทศ',
  'viz.terrainSatellite': 'ดาวเทียม',
  'viz.terrainHypso': 'สีตามความสูง',
  'viz.terrainHeatmap': 'แผนที่ความร้อนความสูง',
  'viz.terrainSurface': 'พื้นผิว (ความเสี่ยงน้ำท่วม)',
  'viz.darkening': 'ความเข้มตามความลึก',
  'viz.vertical': 'แนวตั้ง ×',
  'viz.opacity': 'ความทึบของน้ำ',
  'viz.depthMax': 'สีความลึกสูงสุด (m)',
  'viz.maxFlood': 'ขอบเขตน้ำท่วมสูงสุด',
  'viz.arrows': 'ลูกศรการไหล',
  'viz.wireframe': 'ภูมิประเทศโครงลวด',
  'viz.language': 'ภาษา',

  // Stats
  'stats.location': 'ตำแหน่ง',
  'stats.simTime': 'เวลาจำลอง',
  'stats.rainIn': 'ปริมาณฝน',
  'stats.stored': 'น้ำที่กักเก็บ',
  'stats.flooded': 'พื้นที่น้ำท่วม',
  'stats.maxDepth': 'ความลึกสูงสุด',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': 'กำลังโหลด "{q}"…',
  'toast.loadingSurface': 'กำลังโหลดแบบจำลองพื้นผิว (สิ่งปกคลุมดิน + OSM)…',
  'toast.loaded': 'โหลด {place} แล้ว',
  'toast.notFound': 'ไม่พบผลลัพธ์สำหรับ "{q}"',
  'toast.geocodeFail': 'การระบุพิกัดล้มเหลว ลองอีกครั้งในอีกสักครู่',
  'toast.enterAddress': 'กรุณาป้อนที่อยู่',

  // Misc
  'legend.elevation': 'ความสูง',
  'readout.elev': 'ความสูง',
  'readout.water': 'น้ำ',
};
