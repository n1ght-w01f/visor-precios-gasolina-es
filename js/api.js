/**
 * MITECO Fuel Tracker - API & Data Management Module
 * Handles resilient fetching with multiple proxies, IndexedDB caching,
 * data normalization, geospatial distance calculations, and fast in-memory filtering.
 */

const API_CONFIG = {
  DIRECT_URL: 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/',
  PROXIES: [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
  ],
  CACHE_DB_NAME: 'MitecoFuelDB',
  CACHE_STORE_NAME: 'fuel_stations',
  CACHE_META_KEY: 'miteco_cache_metadata',
  CACHE_TTL_MS: 30 * 60 * 1000 // 30 minutes cache TTL
};

// Fuel Types Mapping & Metadata
const FUEL_TYPES = {
  'gasolina95': {
    id: 'gasolina95',
    name: 'Gasolina 95 E5',
    shortName: 'G95 E5',
    apiKey: 'Precio Gasolina 95 E5',
    color: '#10b981',
    category: 'gasolina'
  },
  'gasoleoA': {
    id: 'gasoleoA',
    name: 'Gasóleo A (Diésel)',
    shortName: 'Diésel A',
    apiKey: 'Precio Gasoleo A',
    color: '#3b82f6',
    category: 'diesel'
  },
  'gasolina98': {
    id: 'gasolina98',
    name: 'Gasolina 98 E5',
    shortName: 'G98 E5',
    apiKey: 'Precio Gasolina 98 E5',
    color: '#8b5cf6',
    category: 'gasolina'
  },
  'gasoleoPremium': {
    id: 'gasoleoPremium',
    name: 'Gasóleo Premium',
    shortName: 'Diésel +',
    apiKey: 'Precio Gasoleo Premium',
    color: '#6366f1',
    category: 'diesel'
  },
  'gasoleoB': {
    id: 'gasoleoB',
    name: 'Gasóleo B (Agrícola)',
    shortName: 'Diésel B',
    apiKey: 'Precio Gasoleo B',
    color: '#f59e0b',
    category: 'diesel'
  },
  'glp': {
    id: 'glp',
    name: 'GLP (Autogás)',
    shortName: 'GLP',
    apiKey: 'Precio Gases licuados del petr\u00f3leo',
    color: '#ec4899',
    category: 'gas'
  },
  'gnc': {
    id: 'gnc',
    name: 'GNC (Gas Comprimido)',
    shortName: 'GNC',
    apiKey: 'Precio Gas Natural Comprimido',
    color: '#14b8a6',
    category: 'gas'
  },
  'adblue': {
    id: 'adblue',
    name: 'AdBlue',
    shortName: 'AdBlue',
    apiKey: 'Precio Adblue',
    color: '#06b6d4',
    category: 'eco'
  },
  'dieselRenovable': {
    id: 'dieselRenovable',
    name: 'Diésel Renovable (HVO)',
    shortName: 'HVO Renovable',
    apiKey: 'Precio Di\u00e9sel Renovable',
    color: '#84cc16',
    category: 'eco'
  },
  'hidrogeno': {
    id: 'hidrogeno',
    name: 'Hidrógeno (H2)',
    shortName: 'H2',
    apiKey: 'Precio Hidrogeno',
    color: '#0ea5e9',
    category: 'eco'
  }
};

// Popular brands removed by request: users filter by fuel type,
// province and municipality only. Text search still supports brand names
// manually (e.g. typing "esclatoil" honors whatever the official data says).

class MitecoAPI {
  constructor() {
    this.rawStations = [];
    this.processedStations = [];
    this.provinces = new Set();
    this.municipalities = new Map(); // province -> Set of municipalities
    this.lastUpdated = null;
    this.db = null;
  }

  /**
   * Initialize IndexedDB instance
   */
  async initDB() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(API_CONFIG.CACHE_DB_NAME, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(API_CONFIG.CACHE_STORE_NAME)) {
          db.createObjectStore(API_CONFIG.CACHE_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      request.onerror = (e) => {
        console.warn('IndexedDB error, fallback to memory cache', e);
        resolve(null);
      };
    });
  }

  /**
   * Save dataset to IndexedDB
   */
  async saveToCache(stations, updateTime) {
    try {
      const db = await this.initDB();
      if (!db) return;
      const tx = db.transaction(API_CONFIG.CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(API_CONFIG.CACHE_STORE_NAME);
      store.clear();
      store.put({ id: 'dataset', data: stations, timestamp: updateTime || Date.now() });
      localStorage.setItem(API_CONFIG.CACHE_META_KEY, JSON.stringify({
        timestamp: updateTime || Date.now(),
        count: stations.length
      }));
    } catch (err) {
      console.warn('Error saving to cache:', err);
    }
  }

  /**
   * Load dataset from IndexedDB
   */
  async loadFromCache() {
    try {
      const db = await this.initDB();
      if (!db) return null;
      return new Promise((resolve) => {
        const tx = db.transaction(API_CONFIG.CACHE_STORE_NAME, 'readonly');
        const store = tx.objectStore(API_CONFIG.CACHE_STORE_NAME);
        const req = store.get('dataset');
        req.onsuccess = () => {
          if (req.result && req.result.data) {
            resolve(req.result);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch (err) {
      return null;
    }
  }

  /**
   * Fetch data with resilient multi-tier fallback
   */
  async fetchFuelData(onProgress = () => {}, forceRefresh = false) {
    // 1. Check local cache first if not forced
    if (!forceRefresh) {
      onProgress({ stage: 'cache_check', message: 'Comprobando caché local...' });
      const cached = await this.loadFromCache();
      if (cached && (Date.now() - cached.timestamp < API_CONFIG.CACHE_TTL_MS)) {
        onProgress({ stage: 'cache_hit', message: `Cargando ${cached.data.length} estaciones desde caché...` });
        this.rawStations = cached.data;
        this.lastUpdated = new Date(cached.timestamp);
        this.processDataset();
        return { source: 'cache', count: this.processedStations.length, timestamp: this.lastUpdated };
      }
    }

    onProgress({ stage: 'fetching', message: 'Conectando con la API oficial del Ministerio (MITECO)...' });

    let rawData = null;
    let successfulStrategy = '';

    // Strategy 1: Direct fetch with standard headers
    try {
      onProgress({ stage: 'fetching', message: 'Descargando datos directamente del MITECO (11.000+ estaciones)...' });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(API_CONFIG.DIRECT_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        rawData = await res.json();
        successfulStrategy = 'direct';
      }
    } catch (err) {
      console.warn('Direct fetch failed or CORS blocked. Switching to backup proxies...', err);
    }

    // Strategy 2 & 3: Fallback through public CORS proxies
    if (!rawData || !rawData.ListaEESSPrecio) {
      for (let i = 0; i < API_CONFIG.PROXIES.length; i++) {
        try {
          const proxyUrl = API_CONFIG.PROXIES[i](API_CONFIG.DIRECT_URL);
          onProgress({ stage: 'fetching', message: `Probando pasarela de respaldo #${i + 1}...` });
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 18000);

          const res = await fetch(proxyUrl, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (res.ok) {
            const json = await res.json();
            // Handle different proxy encapsulation formats (e.g. allorigins contents)
            if (json.ListaEESSPrecio) {
              rawData = json;
              successfulStrategy = `proxy_${i + 1}`;
              break;
            } else if (json.contents) {
              try {
                rawData = JSON.parse(json.contents);
                successfulStrategy = `proxy_${i + 1}_contents`;
                break;
              } catch (e) {
                // not json string
              }
            }
          }
        } catch (proxyErr) {
          console.warn(`Proxy #${i + 1} failed:`, proxyErr);
        }
      }
    }

    // Strategy 4: Fallback to stale cache if online download fails entirely
    if (!rawData || !rawData.ListaEESSPrecio) {
      const staleCached = await this.loadFromCache();
      if (staleCached && staleCached.data) {
        onProgress({ stage: 'cache_stale', message: 'Aviso: Usando datos guardados previamente por fallo de conexión.' });
        this.rawStations = staleCached.data;
        this.lastUpdated = new Date(staleCached.timestamp);
        this.processDataset();
        return { source: 'stale_cache', count: this.processedStations.length, timestamp: this.lastUpdated };
      }
      throw new Error('No se pudo obtener la base de datos de gasolineras ni directa ni mediante pasarelas de respaldo.');
    }

    onProgress({ stage: 'processing', message: 'Indexando y optimizando 11.000+ estaciones de servicio...' });
    
    this.rawStations = rawData.ListaEESSPrecio;
    this.lastUpdated = new Date();
    this.processDataset();
    await this.saveToCache(this.rawStations, this.lastUpdated.getTime());

    onProgress({ stage: 'ready', message: '¡Datos listos y actualizados!' });
    return {
      source: successfulStrategy,
      count: this.processedStations.length,
      timestamp: this.lastUpdated,
      dateString: rawData.Fecha || this.lastUpdated.toLocaleString()
    };
  }

  /**
   * Clean string helper (removes accents, lowercase, trims)
   */
  normalizeText(text) {
    if (!text) return '';
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  /**
   * Parse Spanish price string "1,589" -> float 1.589
   */
  parsePrice(val) {
    if (!val || typeof val !== 'string') return null;
    const clean = val.replace(',', '.').trim();
    const num = parseFloat(clean);
    return isNaN(num) || num <= 0 ? null : num;
  }

  /**
   * Parse coordinate string "39,211417" -> float 39.211417
   */
  parseCoord(val) {
    if (!val || typeof val !== 'string') return null;
    const clean = val.replace(',', '.').trim();
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  }

  /**
   * Process raw stations into optimized in-memory objects
   */
  processDataset() {
    this.provinces = new Set();
    this.municipalities = new Map();

    this.processedStations = this.rawStations.map((s, index) => {
      const lat = this.parseCoord(s['Latitud']);
      const lng = this.parseCoord(s['Longitud (WGS84)']);
      
      const rotulo = (s['R\u00f3tulo'] || s['Rótulo'] || 'INDEPENDIENTE').trim();
      const municipio = (s['Municipio'] || '').trim();
      const provincia = (s['Provincia'] || '').trim();
      const localidad = (s['Localidad'] || '').trim();
      const direccion = (s['Direcci\u00f3n'] || s['Dirección'] || '').trim();
      const cp = (s['C.P.'] || '').trim();
      const horario = (s['Horario'] || '').trim();
      const id = s['IDEESS'] || `est_${index}`;

      // Build structured prices map
      const prices = {};
      let hasAnyPrice = false;

      for (const [fuelKey, config] of Object.entries(FUEL_TYPES)) {
        // Try direct key or accent-insensitive lookup
        let rawPrice = s[config.apiKey];
        if (!rawPrice) {
          // Find fallback key in s
          const matchKey = Object.keys(s).find(k => 
            this.normalizeText(k) === this.normalizeText(config.apiKey)
          );
          if (matchKey) rawPrice = s[matchKey];
        }

        const price = this.parsePrice(rawPrice);
        prices[fuelKey] = price;
        if (price !== null) hasAnyPrice = true;
      }

      if (provincia) {
        this.provinces.add(provincia);
        if (!this.municipalities.has(provincia)) {
          this.municipalities.set(provincia, new Set());
        }
        if (municipio) {
          this.municipalities.get(provincia).add(municipio);
        }
      }

      // Check 24H status
      const is24h = /24\s*h|24\s*horas|L-D:\s*24H/i.test(horario);

      return {
        id,
        rotulo,
        rotuloNorm: this.normalizeText(rotulo),
        municipio,
        municipioNorm: this.normalizeText(municipio),
        provincia,
        provinciaNorm: this.normalizeText(provincia),
        localidad,
        direccion,
        cp,
        horario,
        is24h,
        lat,
        lng,
        hasCoords: lat !== null && lng !== null && lat > 20 && lat < 45 && lng > -20 && lng < 10,
        tipoVenta: s['Tipo Venta'] || 'P',
        prices,
        hasAnyPrice,
        // Search index string combining all searchable properties
        searchIndex: this.normalizeText(`${rotulo} ${municipio} ${provincia} ${localidad} ${direccion} ${cp}`)
      };
    });
  }

  /**
   * Haversine formula to compute distance in km between two GPS points
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null;
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Filter and sort stations with high performance
   */
  filterStations(criteria = {}) {
    const {
      fuelType = 'gasolina95',
      searchText = '',
      brandQuery = '',
      province = '',
      municipio = '',
      only24h = false,
      userLocation = null, // { lat, lng }
      maxDistance = null,  // km
      maxPrice = null,
      sortBy = 'price_asc', // 'price_asc', 'price_desc', 'distance_asc', 'rotulo_asc'
      limit = 200,
      favoriteIds = []
    } = criteria;

    const normSearch = this.normalizeText(searchText);
    const brandRegex = brandQuery ? new RegExp(brandQuery, 'i') : null;
    const onlyFavorites = criteria.onlyFavorites || false;

    // Filter array
    const filtered = [];
    const fuelPrices = [];

    for (let i = 0; i < this.processedStations.length; i++) {
      const s = this.processedStations[i];

      // Favorite filter if requested
      if (onlyFavorites && !favoriteIds.includes(s.id)) {
        continue;
      }

      // Fuel type check: must sell the selected fuel
      const price = s.prices[fuelType];
      if (price === null || price === undefined) {
        continue;
      }

      // Max price filter
      if (maxPrice !== null && price > maxPrice) {
        continue;
      }

      // 24 Hours filter
      if (only24h && !s.is24h) {
        continue;
      }

      // Province filter
      if (province && s.provincia !== province) {
        continue;
      }

      // Municipality filter
      if (municipio && s.municipio !== municipio) {
        continue;
      }

      // Brand quick filter
      if (brandRegex && !brandRegex.test(s.rotulo)) {
        continue;
      }

      // Text search in multi-field index
      if (normSearch && !s.searchIndex.includes(normSearch)) {
        continue;
      }

      // Distance calculation
      let distance = null;
      if (userLocation && userLocation.lat && userLocation.lng && s.hasCoords) {
        distance = this.calculateDistance(userLocation.lat, userLocation.lng, s.lat, s.lng);
        if (maxDistance !== null && distance > maxDistance) {
          continue;
        }
      }

      fuelPrices.push(price);
      filtered.push({
        ...s,
        currentPrice: price,
        distance: distance !== null ? Math.round(distance * 10) / 10 : null
      });
    }

    // Compute statistics for the filtered pool
    const stats = this.computePriceStats(fuelPrices);

    // Sorting
    filtered.sort((a, b) => {
      if (sortBy === 'price_asc') {
        return a.currentPrice - b.currentPrice;
      }
      if (sortBy === 'price_desc') {
        return b.currentPrice - a.currentPrice;
      }
      if (sortBy === 'distance_asc') {
        if (a.distance === null && b.distance === null) return 0;
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      }
      if (sortBy === 'rotulo_asc') {
        return a.rotulo.localeCompare(b.rotulo);
      }
      return 0;
    });

    // Grouping helper if requested
    const groupBy = criteria.groupBy || 'none';
    let groupedData = null;
    if (groupBy && groupBy !== 'none') {
      groupedData = this.groupStations(filtered, groupBy);
    }

    return {
      totalMatches: filtered.length,
      stations: limit > 0 ? filtered.slice(0, limit) : filtered,
      allStationsForMap: filtered,
      groupedData,
      groupBy,
      stats,
      fuelTypeInfo: FUEL_TYPES[fuelType]
    };
  }

  /**
   * Group stations by a given field (municipio, rotulo, provincia)
   */
  groupStations(stations, groupBy = 'municipio') {
    const groupsMap = new Map();

    for (const s of stations) {
      let groupKey = 'Sin especificar';
      if (groupBy === 'municipio') groupKey = s.municipio || 'Sin Municipio';
      else if (groupBy === 'rotulo') groupKey = s.rotulo || 'Sin Rótulo';
      else if (groupBy === 'provincia') groupKey = s.provincia || 'Sin Provincia';

      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, {
          groupKey,
          count: 0,
          prices: [],
          stations: []
        });
      }

      const g = groupsMap.get(groupKey);
      g.count++;
      g.prices.push(s.currentPrice);
      g.stations.push(s);
    }

    const groups = [];
    for (const [key, g] of groupsMap.entries()) {
      const minPrice = Math.min(...g.prices);
      const maxPrice = Math.max(...g.prices);
      const avgPrice = g.prices.reduce((a, b) => a + b, 0) / g.prices.length;

      groups.push({
        groupKey: key,
        count: g.count,
        minPrice: Math.round(minPrice * 1000) / 1000,
        maxPrice: Math.round(maxPrice * 1000) / 1000,
        avgPrice: Math.round(avgPrice * 1000) / 1000,
        stations: g.stations
      });
    }

    // Sort groups by minimum price ascending
    groups.sort((a, b) => a.minPrice - b.minPrice);
    return groups;
  }

  /**
   * Compute min, avg, max, quartiles and savings
   */
  computePriceStats(prices) {
    if (!prices || prices.length === 0) {
      return { min: 0, avg: 0, max: 0, count: 0, savings50L: 0, p25: 0, p75: 0 };
    }

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      sum += p;
      if (p < min) min = p;
      if (p > max) max = p;
    }

    const avg = sum / prices.length;
    const sorted = [...prices].sort((a, b) => a - b);
    const p25 = sorted[Math.floor(sorted.length * 0.25)] || min;
    const p75 = sorted[Math.floor(sorted.length * 0.75)] || max;
    const savings50L = Math.max(0, (avg - min) * 50);

    return {
      min: Math.round(min * 1000) / 1000,
      avg: Math.round(avg * 1000) / 1000,
      max: Math.round(max * 1000) / 1000,
      p25: Math.round(p25 * 1000) / 1000,
      p75: Math.round(p75 * 1000) / 1000,
      count: prices.length,
      savings50L: Math.round(savings50L * 100) / 100
    };
  }

  /**
   * Get sorted list of all provinces
   */
  getProvincesList() {
    return Array.from(this.provinces).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Get municipalities for a specific province
   */
  getMunicipalitiesList(province) {
    if (!province || !this.municipalities.has(province)) return [];
    return Array.from(this.municipalities.get(province)).sort((a, b) => a.localeCompare(b));
  }
}

// Export singleton instance
window.mitecoAPI = new MitecoAPI();
window.FUEL_TYPES = FUEL_TYPES;
