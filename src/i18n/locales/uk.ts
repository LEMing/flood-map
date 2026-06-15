export const uk: Record<string, string> = {
  // Address bar
  'input.placeholder': 'Адреса, місце або "шир, дов"…',
  'btn.load': 'Завантажити',
  'btn.loading': 'Завантаження…',
  'autocomplete.useCoords': 'Використати координати {coords}',

  // Panel + folders
  'panel.title': 'Карта повеней',
  'sim.title': 'Симуляція',
  'rain.title': 'Дощ',
  'urban.title': 'Міська модель',
  'soil.title': 'Ґрунт і випаровування',
  'physics.title': 'Фізика',
  'map.title': 'Карта (перезавантажити)',
  'viz.title': 'Візуалізація',
  'stats.title': 'Статистика',

  // Simulation
  'sim.play': 'Старт ▶',
  'sim.pause': 'Пауза ⏸',
  'sim.step': 'Крок ⏭',
  'sim.reset': 'Скинути ⟳',
  'sim.dump': 'Скинути воду 💧 (раптова повінь)',
  'sim.fill': 'Заповнити до рівня 🌊 (одноразово)',
  'sim.dumpDepth': 'глибина скиду (m)',
  'sim.floodLevel': 'рівень повені (+m)',
  'sim.liveFlood': 'живий рівень повені',
  'sim.timescale': 'час × (сим с/с)',
  'sim.substeps': 'підкроки',

  // Rain
  'rain.raining': 'дощ іде',
  'rain.stormEvent': 'буря',
  'rain.clouds': 'хмари ⛈ + блискавка',
  'rain.constant': 'постійно mm/hr',
  'rain.footprint': 'охоплення',
  'rain.footprintUniform': 'Рівномірно',
  'rain.footprintSpot': 'Грозовий осередок',

  // Urban model
  'urban.surface': 'модель поверхні',
  'urban.buildings': 'будівлі як стіни',
  'urban.sewer': 'зливова каналізація (mm/hr)',
  'urban.groundwater': 'високі ґрунтові води',

  // Soil
  'soil.infiltration': 'інфільтрація ґрунту (mm/hr)',
  'soil.evaporation': 'випаровування (/hr)',

  // Physics
  'physics.gravity': 'гравітація (m/s²)',
  'physics.flow': 'коефіцієнт потоку',
  'physics.friction': 'тертя',
  'physics.edges': 'краї',
  'physics.edgesOpen': 'Відкриті (стік)',
  'physics.edgesClosed': 'Закриті (стіни)',

  // Map
  'map.elevation': 'висота',
  'map.size': 'розмір (km)',
  'map.grid': 'сітка',
  'map.apply': 'Застосувати розмір / сітку ⟲',

  // Visualization
  'viz.terrain': 'рельєф',
  'viz.terrainSatellite': 'Супутник',
  'viz.terrainHypso': 'Тонування за висотою',
  'viz.terrainHeatmap': 'Теплокарта висот',
  'viz.terrainSurface': 'Поверхня (ризик повені)',
  'viz.darkening': 'затемнення за глибиною',
  'viz.vertical': 'вертикаль ×',
  'viz.opacity': 'непрозорість води',
  'viz.depthMax': 'макс. колір глибини (m)',
  'viz.maxFlood': 'макс. розлив повені',
  'viz.arrows': 'стрілки потоку',
  'viz.wireframe': 'каркас рельєфу',
  'viz.language': 'мова',

  // Stats
  'stats.location': 'розташування',
  'stats.simTime': 'час симуляції',
  'stats.rainIn': 'дощу випало',
  'stats.stored': 'накопичено води',
  'stats.flooded': 'затоплена площа',
  'stats.maxDepth': 'макс. глибина',
  'stats.fps': 'fps',

  // Toasts
  'toast.loadingPlace': 'Завантаження «{q}»…',
  'toast.loadingSurface': 'Завантаження моделі поверхні (земний покрив + OSM)…',
  'toast.loaded': 'Завантажено {place}',
  'toast.notFound': 'Не знайдено збігів для «{q}».',
  'toast.geocodeFail': 'Геокодування не вдалося. Спробуйте за мить.',
  'toast.enterAddress': 'Будь ласка, введіть адресу.',
  'toast.detecting': 'Визначаємо ваше місцезнаходження…',

  // Misc
  'legend.elevation': 'Висота',
  'readout.elev': 'вис',
  'readout.water': 'вода',
};
