/**
 * MITECO Fuel Tracker - Main Application Controller
 * Manages UI interactions, live search debounce, filters, grouping,
 * Data Table rendering with pagination, JSON API mode, favorites,
 * export functionality, theme persistence, and URL state synchronization.
 */

class FavoritesManager {
  constructor() {
    this.STORAGE_KEY = 'miteco_favorite_station_ids';
    this.favoriteIds = this.loadFavorites();
  }

  loadFavorites() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  saveFavorites() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.favoriteIds));
    } catch (e) {
      console.warn('Could not save favorites to localStorage', e);
    }
  }

  isFavorite(stationId) {
    return this.favoriteIds.includes(stationId);
  }

  toggleFavorite(stationId) {
    if (this.isFavorite(stationId)) {
      this.favoriteIds = this.favoriteIds.filter(id => id !== stationId);
      this.saveFavorites();
      return false;
    } else {
      this.favoriteIds.push(stationId);
      this.saveFavorites();
      return true;
    }
  }

  getFavoritesCount() {
    return this.favoriteIds.length;
  }
}

class AppController {
  constructor() {
    this.api = window.mitecoAPI;
    this.map = window.mitecoMap;
    this.analytics = window.mitecoAnalytics;
    this.favorites = new FavoritesManager();
    window.favoritesManager = this.favorites;

    // App State
    this.state = {
      fuelType: 'gasolina95',
      searchText: '',
      brandQuery: '',
      province: '',
      municipio: '',
      groupBy: 'none', // 'none', 'municipio', 'rotulo', 'provincia'
      only24h: false,
      onlyFavorites: false,
      maxPrice: null,
      maxDistance: null,
      sortBy: 'price_asc', // 'price_asc', 'price_desc', 'distance_asc', 'rotulo_asc', 'municipio_asc'
      currentView: 'split', // 'split', 'list', 'tabla', 'map'
      userLocation: null, // { lat, lng }
      theme: localStorage.getItem('miteco_theme') || 'dark',
      tablePage: 1,
      tablePageSize: 50,
      trackingActive: false,  // GPS live-tracking mode
      watchId: null,          // geolocation.watchPosition handle
      gpsRadius: 10           // user configurable radius in km (default 10)
    };

    this.currentDataset = null;
    this.searchDebounceTimer = null;
    this.collapsedGroups = new Set();
  }

  /**
   * Initialize application
   */
  async init() {
    this.readUrlParams();
    this.applyTheme(this.state.theme);
    this.bindEvents();

    // Init Map
    this.map.init();

    // Start loading data
    await this.loadData(false);
  }

  /**
   * Load data from API with interactive loading screen
   */
  async loadData(forceRefresh = false) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingStatus = document.getElementById('loading-status-text');
    const loadingBar = document.getElementById('loading-progress-fill');
    const lastUpdateBadge = document.getElementById('last-update-time');

    if (loadingOverlay) {
      loadingOverlay.classList.remove('hidden');
    }

    try {
      const result = await this.api.fetchFuelData((progress) => {
        if (loadingStatus) loadingStatus.textContent = progress.message;
        if (loadingBar) {
          if (progress.stage === 'cache_check') loadingBar.style.width = '20%';
          if (progress.stage === 'fetching') loadingBar.style.width = '55%';
          if (progress.stage === 'processing') loadingBar.style.width = '85%';
          if (progress.stage === 'ready') loadingBar.style.width = '100%';
        }
      }, forceRefresh);

      // Populate province dropdown
      this.populateProvinceSelect();

      // Update badge
      if (lastUpdateBadge && this.api.lastUpdated) {
        const timeStr = this.api.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = this.api.lastUpdated.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
        lastUpdateBadge.textContent = `${dateStr} ${timeStr}`;
      }

      // Initial filter apply
      this.applyFilters(true);

      // Hide overlay
      setTimeout(() => {
        if (loadingOverlay) loadingOverlay.classList.add('hidden');
      }, 350);

    } catch (err) {
      console.error('Fatal fetch error:', err);
      if (loadingStatus) {
        loadingStatus.innerHTML = `<span class="error-text">❌ Error al cargar datos: ${err.message}.</span><br><button id="btn-retry-load" class="btn btn-sm btn-primary mt-2">Reintentar</button>`;
        const btnRetry = document.getElementById('btn-retry-load');
        if (btnRetry) btnRetry.onclick = () => this.loadData(true);
      }
    }
  }

  /**
   * Apply filters and update UI across all views
   */
  applyFilters(autoFitMap = false) {
    // While GPS live-tracking is active, manual location filters are
    // visually grayed out AND ignored: position + radius rule everything.
    const tracking = this.state.trackingActive;

    const criteria = {
      fuelType: this.state.fuelType,
      searchText: tracking ? '' : this.state.searchText,
      brandQuery: tracking ? '' : this.state.brandQuery,
      province: tracking ? '' : this.state.province,
      municipio: tracking ? '' : this.state.municipio,
      groupBy: this.state.groupBy,
      only24h: this.state.only24h,
      onlyFavorites: this.state.onlyFavorites,
      maxPrice: this.state.maxPrice,
      maxDistance: this.state.maxDistance,
      userLocation: this.state.userLocation,
      sortBy: this.state.sortBy,
      limit: 0, // No limit for full in-memory rendering and table pagination
      favoriteIds: this.favorites.favoriteIds
    };

    const dataset = this.api.filterStations(criteria);
    this.currentDataset = dataset;

    // Update stations list UI (top 100 for card view performance)
    this.renderStationsList(dataset.allStationsForMap.slice(0, 100), dataset.fuelTypeInfo, dataset.stats);

    // Update Table UI
    this.renderDataTable();

    // Update map markers
    this.map.renderStations(dataset.allStationsForMap, dataset.fuelTypeInfo, dataset.stats, autoFitMap);

    // Update analytics & stats cards
    const cheapest = dataset.allStationsForMap.length > 0 ? dataset.allStationsForMap[0] : null;
    this.analytics.updateStatsCards(dataset.stats, dataset.fuelTypeInfo, cheapest);
    this.analytics.renderHistogram(dataset.allStationsForMap, dataset.stats, dataset.fuelTypeInfo);

    // Update counter badges
    const totalCountBadge = document.getElementById('results-count-badge');
    if (totalCountBadge) {
      totalCountBadge.textContent = `${dataset.totalMatches.toLocaleString()} estaciones encontradas`;
    }

    const tableCounter = document.getElementById('table-results-counter');
    if (tableCounter) {
      tableCounter.textContent = `${dataset.totalMatches.toLocaleString()} estaciones encontradas`;
    }

    const groupStatusBadge = document.getElementById('table-group-status-badge');
    if (groupStatusBadge) {
      if (this.state.groupBy === 'none') {
        groupStatusBadge.textContent = 'Sin agrupar';
      } else if (this.state.groupBy === 'municipio') {
        groupStatusBadge.textContent = `📂 ${dataset.groupedData ? dataset.groupedData.length : 0} Municipios`;
      } else if (this.state.groupBy === 'rotulo') {
        groupStatusBadge.textContent = `🏢 ${dataset.groupedData ? dataset.groupedData.length : 0} Marcas`;
      } else if (this.state.groupBy === 'provincia') {
        groupStatusBadge.textContent = `🗺️ ${dataset.groupedData ? dataset.groupedData.length : 0} Provincias`;
      }
    }

    // Update URL query parameters
    this.updateUrlParams();

    // Update share modal URL if open
    this.updateApiModalContent();
  }

  /**
   * Render station cards in the list container
   */
  renderStationsList(stations, fuelTypeInfo, stats) {
    const listContainer = document.getElementById('stations-cards-list');
    if (!listContainer) return;

    if (!stations || stations.length === 0) {
      listContainer.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">⛽</div>
          <h3>No se han encontrado gasolineras</h3>
          <p>Prueba a cambiar los filtros, buscar en otro municipio o seleccionar otro tipo de combustible.</p>
          <button id="btn-reset-filters" class="btn btn-sm btn-outline">Restablecer filtros</button>
        </div>
      `;
      const btnReset = document.getElementById('btn-reset-filters');
      if (btnReset) {
        btnReset.onclick = () => this.resetFilters();
      }
      return;
    }

    let html = '';
    stations.forEach((s, rank) => {
      const isFav = this.favorites.isFavorite(s.id);
      const tier = this.map.getPriceTier(s.currentPrice, stats);
      const tierBadge = tier === 'cheap' 
        ? '<span class="badge-tier tier-cheap">💎 Más barata</span>' 
        : (tier === 'expensive' ? '<span class="badge-tier tier-expensive">Alto</span>' : '');

      const isTopRank = rank === 0 ? '<span class="badge-rank rank-1">#1 Más Económica</span>' : (rank < 3 ? `<span class="badge-rank">#${rank + 1}</span>` : '');

      html += `
        <article class="station-card ${isFav ? 'is-favorite' : ''}" data-id="${s.id}" data-lat="${s.lat}" data-lng="${s.lng}">
          <div class="card-top-row">
            <div class="card-brand-group">
              <span class="card-brand-name">${escapeHtml(s.rotulo)}</span>
              ${isTopRank}
              ${tierBadge}
            </div>
            <button class="card-fav-btn ${isFav ? 'active' : ''}" data-id="${s.id}" title="Favorita">
              ${isFav ? '★' : '☆'}
            </button>
          </div>

          <div class="card-main-content">
            <div class="card-address-block">
              <div class="card-address">${escapeHtml(s.direccion)}</div>
              <div class="card-location">${escapeHtml(s.municipio)} <span class="loc-prov">(${escapeHtml(s.provincia)})</span></div>
              <div class="card-meta-tags">
                <span class="card-tag ${s.is24h ? 'tag-24h' : ''}">🕒 ${escapeHtml(s.horario || 'Sin horario')}</span>
                ${s.distance !== null ? `<span class="card-tag tag-distance">📍 ${s.distance} km</span>` : ''}
              </div>
            </div>

            <div class="card-price-hero">
              <div class="price-val">${s.currentPrice.toFixed(3)} <span class="price-unit">€/L</span></div>
              <div class="price-fuel-name">${escapeHtml(fuelTypeInfo.shortName)}</div>
            </div>
          </div>

          <div class="card-footer-actions">
            <button class="btn-card-action btn-view-map" data-id="${s.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon></svg>
              Ver en mapa
            </button>
            <button class="btn-card-action btn-show-details" data-id="${s.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              Todos los precios
            </button>
            <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener noreferrer" class="btn-card-action btn-navigate">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
              Cómo llegar
            </a>
          </div>
        </article>
      `;
    });

    listContainer.innerHTML = html;

    // Attach card event listeners
    listContainer.querySelectorAll('.card-fav-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const nowFav = this.favorites.toggleFavorite(id);
        btn.innerHTML = nowFav ? '★' : '☆';
        btn.classList.toggle('active', nowFav);
        this.onFavoritesChanged();
      };
    });

    listContainer.querySelectorAll('.btn-view-map').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const st = this.api.processedStations.find(x => x.id === id);
        if (st) {
          if (this.state.currentView !== 'split') {
            this.switchView('split');
          }
          this.map.flyToStation(st);
        }
      };
    });

    listContainer.querySelectorAll('.btn-show-details').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const st = this.api.processedStations.find(x => x.id === id);
        if (st) this.openStationModal(st);
      };
    });
  }

  /**
   * Render Data Table with Grouping & Pagination support
   */
  renderDataTable() {
    const tbody = document.getElementById('table-stations-body');
    if (!tbody || !this.currentDataset) return;

    const dataset = this.currentDataset;
    const isGrouped = this.state.groupBy !== 'none' && dataset.groupedData;

    if (dataset.totalMatches === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
            No se encontraron gasolineras con los filtros actuales.
          </td>
        </tr>
      `;
      this.updatePaginationUI(0, 0, 0);
      return;
    }

    let html = '';

    if (isGrouped) {
      // Render Grouped Table
      dataset.groupedData.forEach((group, gIdx) => {
        const isCollapsed = this.collapsedGroups.has(group.groupKey);
        html += `
          <tr class="table-group-header-row ${isCollapsed ? 'group-collapsed' : ''}" data-group="${escapeHtml(group.groupKey)}">
            <td colspan="9">
              <div class="group-header-content">
                <div class="group-title-left">
                  <span class="group-toggle-icon">▼</span>
                  <strong>${escapeHtml(group.groupKey)}</strong>
                  <span class="group-stat-pill">${group.count} estaciones</span>
                </div>
                <div class="group-stats-right">
                  <span>Mín: <strong style="color: var(--price-cheap);">${group.minPrice.toFixed(3)}€</strong></span>
                  <span>Media: <strong>${group.avgPrice.toFixed(3)}€</strong></span>
                  <span>Máx: <strong style="color: var(--price-expensive);">${group.maxPrice.toFixed(3)}€</strong></span>
                </div>
              </div>
            </td>
          </tr>
        `;

        if (!isCollapsed) {
          group.stations.forEach((s, idx) => {
            html += this.buildTableRowHtml(s, idx + 1, dataset.stats);
          });
        }
      });

      tbody.innerHTML = html;
      this.updatePaginationUI(dataset.totalMatches, dataset.totalMatches, 1);

    } else {
      // Render Flat Paginated Table
      const allStations = dataset.allStationsForMap;
      const total = allStations.length;
      const pageSize = this.state.tablePageSize;
      const totalPages = Math.ceil(total / pageSize) || 1;

      if (this.state.tablePage > totalPages) this.state.tablePage = totalPages;
      if (this.state.tablePage < 1) this.state.tablePage = 1;

      const startIndex = (this.state.tablePage - 1) * pageSize;
      const pageStations = allStations.slice(startIndex, startIndex + pageSize);

      pageStations.forEach((s, idx) => {
        html += this.buildTableRowHtml(s, startIndex + idx + 1, dataset.stats);
      });

      tbody.innerHTML = html;
      this.updatePaginationUI(startIndex + 1, Math.min(startIndex + pageSize, total), total);
    }

    // Attach row action handlers
    tbody.querySelectorAll('.table-group-header-row').forEach(row => {
      row.onclick = () => {
        const groupKey = row.dataset.group;
        if (this.collapsedGroups.has(groupKey)) {
          this.collapsedGroups.delete(groupKey);
        } else {
          this.collapsedGroups.add(groupKey);
        }
        this.renderDataTable();
      };
    });

    tbody.querySelectorAll('.table-btn-details').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const st = this.api.processedStations.find(x => x.id === id);
        if (st) this.openStationModal(st);
      };
    });

    tbody.querySelectorAll('.table-btn-map').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const st = this.api.processedStations.find(x => x.id === id);
        if (st) {
          this.switchView('split');
          this.map.flyToStation(st);
        }
      };
    });
  }

  /**
   * Helper to build a single <tr> for table
   */
  buildTableRowHtml(s, rankNum, stats) {
    const isFav = this.favorites.isFavorite(s.id);
    const tier = this.map.getPriceTier(s.currentPrice, stats);
    const tierClass = tier === 'cheap' ? 'price-cheap' : '';

    return `
      <tr class="${isFav ? 'is-fav-row' : ''}">
        <td class="cell-rank">#${rankNum}</td>
        <td class="cell-brand">
          <span>${escapeHtml(s.rotulo)}</span>
          ${isFav ? '<span style="color:#f59e0b;">★</span>' : ''}
        </td>
        <td><strong>${escapeHtml(s.municipio)}</strong></td>
        <td>${escapeHtml(s.provincia)}</td>
        <td style="max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(s.direccion)}">${escapeHtml(s.direccion)}</td>
        <td><small>${escapeHtml(s.horario || 'N/D')}</small></td>
        <td class="cell-price ${tierClass}">${s.currentPrice.toFixed(3)} €</td>
        <td>${s.distance !== null ? s.distance + ' km' : '--'}</td>
        <td class="cell-actions">
          <button class="btn btn-sm btn-outline table-btn-map" data-id="${s.id}" title="Ver en mapa">📍</button>
          <button class="btn btn-sm btn-outline table-btn-details" data-id="${s.id}" title="Ver todos los precios">ℹ️</button>
          <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline" title="Cómo llegar">🧭</a>
        </td>
      </tr>
    `;
  }

  /**
   * Update pagination indicators and buttons
   */
  updatePaginationUI(start, end, total) {
    const infoText = document.getElementById('pagination-info-text');
    const pageCurrent = document.getElementById('pagination-page-current');
    const prevBtn = document.getElementById('btn-page-prev');
    const nextBtn = document.getElementById('btn-page-next');

    if (infoText) {
      infoText.textContent = total > 0 ? `Mostrando ${start} - ${end} de ${total.toLocaleString()}` : '0 estaciones';
    }

    const isGrouped = this.state.groupBy !== 'none';
    if (isGrouped) {
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      if (pageCurrent) pageCurrent.textContent = 'Vista Agrupada';
      return;
    }

    const totalPages = Math.ceil(total / this.state.tablePageSize) || 1;
    if (pageCurrent) pageCurrent.textContent = `Página ${this.state.tablePage} de ${totalPages}`;
    if (prevBtn) prevBtn.disabled = this.state.tablePage <= 1;
    if (nextBtn) nextBtn.disabled = this.state.tablePage >= totalPages;
  }

  /**
   * Populate Province dropdown
   */
  populateProvinceSelect() {
    const provSelect = document.getElementById('filter-province');
    if (!provSelect) return;

    const provinces = this.api.getProvincesList();
    provSelect.innerHTML = '<option value="">Todas las Provincias</option>' +
      provinces.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');

    if (this.state.province) {
      provSelect.value = this.state.province;
      this.populateMunicipalitySelect(this.state.province);
    }
  }

  /**
   * Populate Municipality dropdown based on chosen province
   */
  populateMunicipalitySelect(province) {
    const munSelect = document.getElementById('filter-municipio');
    if (!munSelect) return;

    if (!province) {
      munSelect.innerHTML = '<option value="">Todos los Municipios</option>';
      munSelect.disabled = true;
      return;
    }

    const munis = this.api.getMunicipalitiesList(province);
    munSelect.disabled = false;
    munSelect.innerHTML = '<option value="">Todos los Municipios</option>' +
      munis.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');

    if (this.state.municipio) {
      munSelect.value = this.state.municipio;
    }
  }

  /**
   * Open station detail modal with all fuel prices
   */
  openStationModal(station) {
    const modal = document.getElementById('station-detail-modal');
    const modalBody = document.getElementById('modal-station-details');
    if (!modal || !modalBody) return;

    let fuelsTableHtml = '<div class="modal-fuels-grid">';
    for (const [key, fuel] of Object.entries(window.FUEL_TYPES)) {
      const price = station.prices[key];
      const isSelected = key === this.state.fuelType;
      fuelsTableHtml += `
        <div class="modal-fuel-row ${isSelected ? 'is-selected' : ''} ${price ? 'available' : 'unavailable'}">
          <div class="modal-fuel-info">
            <span class="fuel-dot" style="background-color: ${fuel.color}"></span>
            <span class="modal-fuel-title">${escapeHtml(fuel.name)}</span>
          </div>
          <div class="modal-fuel-price">
            ${price !== null ? `<strong>${price.toFixed(3)}</strong> €/L` : '<span class="price-na">No disponible</span>'}
          </div>
        </div>
      `;
    }
    fuelsTableHtml += '</div>';

    const isFav = this.favorites.isFavorite(station.id);

    modalBody.innerHTML = `
      <div class="modal-station-header">
        <div class="modal-brand-name">${escapeHtml(station.rotulo)}</div>
        <div class="modal-badge-id">ID: ${station.id}</div>
      </div>

      <div class="modal-info-list">
        <div class="modal-info-item">
          <strong>Dirección:</strong> <span>${escapeHtml(station.direccion)}</span>
        </div>
        <div class="modal-info-item">
          <strong>Municipio:</strong> <span>${escapeHtml(station.municipio)} (${escapeHtml(station.provincia)})</span>
        </div>
        <div class="modal-info-item">
          <strong>Código Postal:</strong> <span>${escapeHtml(station.cp || 'N/A')}</span>
        </div>
        <div class="modal-info-item">
          <strong>Horario:</strong> <span>${escapeHtml(station.horario || 'No disponible')}</span>
        </div>
        <div class="modal-info-item">
          <strong>Tipo de Venta:</strong> <span>${station.tipoVenta === 'P' ? 'Pública' : 'Restringida/Cooperativa'}</span>
        </div>
      </div>

      <h4 class="modal-section-heading">Tabla de Precios Actualizados</h4>
      ${fuelsTableHtml}

      <div class="modal-actions-row">
        <button id="modal-toggle-fav" class="btn btn-outline ${isFav ? 'active' : ''}">
          ${isFav ? '★ Quitar de favoritas' : '☆ Guardar en favoritas'}
        </button>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
          Abrir en Google Maps
        </a>
      </div>
    `;

    const favBtn = document.getElementById('modal-toggle-fav');
    if (favBtn) {
      favBtn.onclick = () => {
        const nowFav = this.favorites.toggleFavorite(station.id);
        favBtn.innerHTML = nowFav ? '★ Quitar de favoritas' : '☆ Guardar en favoritas';
        favBtn.classList.toggle('active', nowFav);
        this.onFavoritesChanged();
      };
    }

    modal.classList.remove('hidden');
  }

  /**
   * Open Share & JSON API modal
   */
  openApiModal() {
    const modal = document.getElementById('api-share-modal');
    if (!modal) return;
    this.updateApiModalContent();
    modal.classList.remove('hidden');
  }

  /**
   * Update share modal content with the current filtered URL
   */
  updateApiModalContent() {
    const webInput = document.getElementById('input-shareable-web-url');
    if (!webInput) return;

    const params = this.buildUrlSearchParams();
    const base = window.location.origin + window.location.pathname;
    const fullWebUrl = base + (params.toString() ? '?' + params.toString() : '');

    webInput.value = fullWebUrl;
  }

  /**
   * Reset all filters to default
   */
  resetFilters() {
    this.state.searchText = '';
    this.state.brandQuery = '';
    this.state.province = '';
    this.state.municipio = '';
    this.state.groupBy = 'none';
    this.state.only24h = false;
    this.state.onlyFavorites = false;
    this.state.maxPrice = null;
    this.state.maxDistance = null;
    this.state.sortBy = 'price_asc';
    this.state.tablePage = 1;

    const searchInput = document.getElementById('input-main-search');
    if (searchInput) searchInput.value = '';

    const provSelect = document.getElementById('filter-province');
    if (provSelect) provSelect.value = '';

    const munSelect = document.getElementById('filter-municipio');
    if (munSelect) {
      munSelect.innerHTML = '<option value="">Todos los Municipios</option>';
      munSelect.disabled = true;
    }

    const groupSelect = document.getElementById('filter-group-by');
    if (groupSelect) groupSelect.value = 'none';

    const check24h = document.getElementById('filter-check-24h');
    if (check24h) check24h.checked = false;

    const sortSelect = document.getElementById('select-sort-order');
    if (sortSelect) sortSelect.value = 'price_asc';

    // Stop GPS tracking if it was running (also renables locked inputs)
    if (this.state.trackingActive) {
      this.stopTracking();
    }

    this.state.gpsRadius = parseInt(document.getElementById('gps-radius-slider')?.value || this.state.gpsRadius, 10);
    this.applyFilters(true);
  }

  /**
   * GPS live-tracking mode (toggle)
   * While active: filters by province/municipio/search are locked & ignored,
   * results are filtered by the configured radius around the current position
   * in real time (watchPosition) — designed to be used while driving.
   */
  requestUserLocation() {
    if (this.state.trackingActive) {
      this.stopTracking();
    } else {
      this.startTracking();
    }
  }

  startTracking() {
    const locBtn = document.getElementById('btn-get-location');

    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización.');
      return;
    }

    this.state.trackingActive = true;
    this.state.maxDistance = this.state.gpsRadius;

    // Lock & gray out manual filters while tracking
    this.setFiltersLocked(true);
    this.updateRadiusPanelVisibility(true);

    if (locBtn) {
      locBtn.classList.add('active');
      locBtn.innerHTML = '🛑 Dejar de seguir GPS';
    }

    this.state.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onTrackingPosition(pos),
      (err) => {
        // Provide specific error messages for each GeolocationPositionError code
        const messages = {
          1: 'Permiso de ubicación denegado. Haz clic en el icono del candado en la barra de direcciones y permite el acceso a la ubicación.',
          2: 'No se pudo determinar tu posición. Comprueba que el GPS o la conexión a internet funcionan correctamente.',
          3: 'La solicitud de ubicación está tardando demasiado. Sigue intentando o ajusta el radio.'
        };
        const msg = messages[err.code] || `Error de geolocalización (código ${err.code}).`;
        alert('📍 ' + msg);
        console.warn('Geolocation error:', err.code, err.message);
        this.stopTracking();
      },
      { enableHighAccuracy: true, timeout: 21000, maximumAge: 3000 }
    );

    // Enable distance sort option while tracking
    const sortSelect = document.getElementById('select-sort-order');
    if (sortSelect) {
      const distOpt = sortSelect.querySelector('option[value="distance_asc"]');
      if (distOpt) distOpt.disabled = false;
    }
  }

  stopTracking() {
    if (this.state.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.state.watchId);
      this.state.watchId = null;
    }

    this.state.trackingActive = false;
    this.state.userLocation = null;
    this.state.maxDistance = null;

    this.setFiltersLocked(false);
    this.updateRadiusPanelVisibility(false);

    const locBtn = document.getElementById('btn-get-location');
    if (locBtn) {
      locBtn.classList.remove('active');
      locBtn.innerHTML = '📍 Mi ubicación';
    }

    this.map.removeUserLocation();

    // Disable distance sort option again
    const sortSelect = document.getElementById('select-sort-order');
    if (sortSelect) {
      const distOpt = sortSelect.querySelector('option[value="distance_asc"]');
      if (distOpt && this.state.sortBy === 'distance_asc') {
        this.state.sortBy = 'price_asc';
        sortSelect.value = 'price_asc';
      }
      if (distOpt) distOpt.disabled = true;
    }

    this.applyFilters(false);
  }

  /**
   * Real-time position callback: fires continuously while the user moves.
   */
  onTrackingPosition(pos) {
    if (!this.state.trackingActive) return;

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    this.state.userLocation = { lat: lat, lng: lng };

    // Draw user pulse + radius circle on map
    this.map.setUserLocation(lat, lng, this.state.maxDistance);

    // Follow the user if the map is currently visible
    if (this.map.map && (this.state.currentView === 'split' || this.state.currentView === 'map')) {
      try {
        const currentZoom = this.map.map.getZoom();
        const targetZoom = currentZoom < 11 ? 12 : currentZoom;
        this.map.map.setView([lat, lng], targetZoom);
      } catch (e) {
        console.warn('Map setView failed (map may not be rendered yet):', e);
      }
    }

    this.applyFilters(false);
  }

  /**
   * Enable / disable (and gray out) the manual location filters while GPS tracking.
   */
  setFiltersLocked(locked) {
    const searchInput = document.getElementById('input-main-search');
    const provSelect = document.getElementById('filter-province');
    const munSelect = document.getElementById('filter-municipio');

    [searchInput, provSelect, munSelect].forEach(el => {
      if (!el) return;
      if (locked) {
        el.disabled = true;
      } else {
        // Municipality select only re-enables when a province is chosen
        if (el === munSelect && !this.state.province) {
          munSelect.disabled = true;
        } else {
          el.disabled = false;
        }
      }
      el.classList.toggle('filter-locked', locked);
    });
  }

  /**
   * Show / hide the GPS radius slider panel.
   */
  updateRadiusPanelVisibility(visible) {
    const panel = document.getElementById('gps-radius-panel');
    if (!panel) return;

    panel.hidden = !visible;

    const slider = document.getElementById('gps-radius-slider');
    const valueLabel = document.getElementById('gps-radius-value');
    if (slider && !visible) {
      slider.value = this.state.gpsRadius;
    }
    if (valueLabel) {
      valueLabel.textContent = `${this.state.gpsRadius} km`;
    }
  }


  /**
   * Switch between views (Split, List, Tabla, Map)
   */
  switchView(viewName) {
    this.state.currentView = viewName;
    const appLayout = document.getElementById('app-main-layout');
    const viewButtons = document.querySelectorAll('.view-tab-btn');

    viewButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    if (appLayout) {
      appLayout.setAttribute('data-view', viewName);
    }

    if (viewName === 'tabla') {
      this.renderDataTable();
    }

    // Invalidate map size on layout shift
    setTimeout(() => {
      this.map.invalidateSize();
    }, 150);

    this.updateUrlParams();
  }

  /**
   * Switch Dark / Light Theme
   */
  applyTheme(theme) {
    this.state.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('miteco_theme', theme);

    const themeToggleBtn = document.getElementById('btn-theme-toggle');
    if (themeToggleBtn) {
      themeToggleBtn.innerHTML = theme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro';
    }
  }

  /**
   * Build URL Search Params object
   */
  buildUrlSearchParams() {
    const params = new URLSearchParams();
    if (this.state.fuelType !== 'gasolina95') params.set('combustible', this.state.fuelType);
    if (this.state.province) params.set('provincia', this.state.province);
    if (this.state.municipio) params.set('municipio', this.state.municipio);
    if (this.state.searchText) params.set('buscar', this.state.searchText);
    if (this.state.brandQuery) params.set('rotulo', this.state.brandQuery);
    if (this.state.groupBy !== 'none') params.set('agrupar', this.state.groupBy);
    if (this.state.sortBy !== 'price_asc') params.set('orden', this.state.sortBy);
    if (this.state.currentView !== 'split') params.set('vista', this.state.currentView);
    return params;
  }

  /**
   * Synchronize URL parameters
   */
  updateUrlParams() {
    const params = this.buildUrlSearchParams();
    const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({}, '', newUrl);
  }

  /**
   * Read URL parameters on start
   */
  readUrlParams() {
    const params = new URLSearchParams(window.location.search);

    const fuelParam = params.get('combustible') || params.get('fuel');
    if (fuelParam && window.FUEL_TYPES[fuelParam]) {
      this.state.fuelType = fuelParam;
      document.querySelectorAll('.fuel-pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.fuel === fuelParam);
      });
    }

    if (params.get('provincia')) this.state.province = params.get('provincia');
    if (params.get('municipio') || params.get('city')) this.state.municipio = params.get('municipio') || params.get('city');
    if (params.get('buscar') || params.get('q')) this.state.searchText = params.get('buscar') || params.get('q');
    if (params.get('rotulo') || params.get('brand') || params.get('marca')) this.state.brandQuery = params.get('rotulo') || params.get('brand') || params.get('marca');
    if (params.get('agrupar') || params.get('group')) this.state.groupBy = params.get('agrupar') || params.get('group');
    if (params.get('orden') || params.get('sort')) this.state.sortBy = params.get('orden') || params.get('sort');
    if (params.get('vista') || params.get('view')) this.state.currentView = params.get('vista') || params.get('view');
  }

  /**
   * Favorites count & refresh
   */
  onFavoritesChanged() {
    const favCountEl = document.getElementById('fav-counter-badge');
    if (favCountEl) {
      favCountEl.textContent = this.favorites.getFavoritesCount();
    }
    if (this.state.onlyFavorites) {
      this.applyFilters(false);
    }
  }

  /**
   * Bind DOM Events
   */
  bindEvents() {
    // Fuel selector tabs
    const fuelTabs = document.querySelectorAll('.fuel-pill-btn');
    fuelTabs.forEach(tab => {
      tab.onclick = () => {
        fuelTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.state.fuelType = tab.dataset.fuel;
        this.applyFilters(false);
      };
    });

    // Search bar debounce
    const searchInput = document.getElementById('input-main-search');
    if (searchInput) {
      if (this.state.searchText) searchInput.value = this.state.searchText;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.state.searchText = e.target.value;
          this.state.tablePage = 1;
          this.applyFilters(true);
        }, 250);
      });
    }

    // Province dropdown
    const provSelect = document.getElementById('filter-province');
    if (provSelect) {
      provSelect.addEventListener('change', (e) => {
        this.state.province = e.target.value;
        this.state.municipio = '';
        this.state.tablePage = 1;
        this.populateMunicipalitySelect(this.state.province);
        this.applyFilters(true);
      });
    }

    // Municipality dropdown
    const munSelect = document.getElementById('filter-municipio');
    if (munSelect) {
      munSelect.addEventListener('change', (e) => {
        this.state.municipio = e.target.value;
        this.state.tablePage = 1;
        this.applyFilters(true);
      });
    }

    // Group By dropdown
    const groupSelect = document.getElementById('filter-group-by');
    if (groupSelect) {
      if (this.state.groupBy) groupSelect.value = this.state.groupBy;
      groupSelect.addEventListener('change', (e) => {
        this.state.groupBy = e.target.value;
        this.state.tablePage = 1;
        this.applyFilters(false);
      });
    }

    // Sort order
    const sortSelect = document.getElementById('select-sort-order');
    if (sortSelect) {
      if (this.state.sortBy) sortSelect.value = this.state.sortBy;
      sortSelect.addEventListener('change', (e) => {
        this.state.sortBy = e.target.value;
        this.applyFilters(false);
      });
    }

    // Table header sort clicks
    document.querySelectorAll('.th-sortable').forEach(th => {
      th.onclick = () => {
        const sortKey = th.dataset.sort;
        if (sortKey === 'price') {
          this.state.sortBy = this.state.sortBy === 'price_asc' ? 'price_desc' : 'price_asc';
        } else if (sortKey === 'rotulo') {
          this.state.sortBy = 'rotulo_asc';
        } else if (sortKey === 'municipio') {
          this.state.sortBy = 'municipio_asc';
        } else if (sortKey === 'dist') {
          this.state.sortBy = 'distance_asc';
        } else if (sortKey === 'rank') {
          this.state.sortBy = 'price_asc';
        }
        if (sortSelect) sortSelect.value = this.state.sortBy;
        this.applyFilters(false);
      };
    });

    // Pagination buttons
    const prevBtn = document.getElementById('btn-page-prev');
    if (prevBtn) {
      prevBtn.onclick = () => {
        if (this.state.tablePage > 1) {
          this.state.tablePage--;
          this.renderDataTable();
        }
      };
    }

    const nextBtn = document.getElementById('btn-page-next');
    if (nextBtn) {
      nextBtn.onclick = () => {
        this.state.tablePage++;
        this.renderDataTable();
      };
    }

    // View switch tabs
    document.querySelectorAll('.view-tab-btn').forEach(btn => {
      btn.onclick = () => this.switchView(btn.dataset.view);
    });

    // Theme Toggle
    const themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) {
      themeBtn.onclick = () => {
        this.applyTheme(this.state.theme === 'dark' ? 'light' : 'dark');
      };
    }

    // Force Refresh Button
    const refreshBtn = document.getElementById('btn-refresh-data');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.loadData(true);
    }

    // Geolocation Button (toggles real-time GPS tracking mode)
    const locBtn = document.getElementById('btn-get-location');
    if (locBtn) {
      locBtn.onclick = () => this.requestUserLocation();
    }

    // GPS Radius Slider (while tracking mode is active)
    const radiusSlider = document.getElementById('gps-radius-slider');
    if (radiusSlider) {
      radiusSlider.value = this.state.gpsRadius;
      radiusSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        if (isNaN(val)) return;

        this.state.gpsRadius = val;
        const valueLabel = document.getElementById('gps-radius-value');
        if (valueLabel) valueLabel.textContent = `${val} km`;

        // Live re-filter with the new radius if tracking is running
        if (this.state.trackingActive) {
          this.state.maxDistance = val;
          if (this.state.userLocation) {
            this.map.setUserLocation(this.state.userLocation.lat, this.state.userLocation.lng, val);
          }
          this.applyFilters(false);
        }
      });
    }

    // Mobile: collapse / expand the map pane
    const mapToggleBtn = document.getElementById('btn-toggle-map');
    if (mapToggleBtn) {
      mapToggleBtn.onclick = () => {
        const pane = mapToggleBtn.closest('.map-pane-container');
        if (!pane) return;

        const nowCollapsed = pane.classList.toggle('map-collapsed');
        const labelSpan = mapToggleBtn.querySelector('span');
        if (labelSpan) {
          labelSpan.textContent = nowCollapsed ? 'Mostrar mapa' : 'Ocultar mapa';
        }

        // Give the CSS transition a moment, then recalculate the map canvas
        setTimeout(() => this.map.invalidateSize(), 250);
      };
    }

    // Favorites Filter Button
    const favTabBtn = document.getElementById('btn-filter-favorites');
    if (favTabBtn) {
      favTabBtn.onclick = () => {
        this.state.onlyFavorites = !this.state.onlyFavorites;
        favTabBtn.classList.toggle('active', this.state.onlyFavorites);
        this.applyFilters(false);
      };
    }

    // API / Share Modal Open & Close
    const openApiModalBtn = document.getElementById('btn-open-api-modal');
    if (openApiModalBtn) openApiModalBtn.onclick = () => this.openApiModal();

    const apiModal = document.getElementById('api-share-modal');
    const apiModalClose = document.getElementById('api-modal-close-btn');
    if (apiModalClose && apiModal) {
      apiModalClose.onclick = () => apiModal.classList.add('hidden');
      apiModal.onclick = (e) => {
        if (e.target === apiModal) apiModal.classList.add('hidden');
      };
    }

    // Copy Button inside Share Modal
    const copyWebBtn = document.getElementById('btn-copy-web-url');
    if (copyWebBtn) {
      copyWebBtn.onclick = () => {
        const input = document.getElementById('input-shareable-web-url');
        if (input) {
          navigator.clipboard.writeText(input.value);
          copyWebBtn.textContent = '✓ ¡Copiado!';
          setTimeout(() => copyWebBtn.textContent = '📋 Copiar Enlace', 2000);
        }
      };
    }

    // Modal Close
    const modal = document.getElementById('station-detail-modal');
    const modalClose = document.getElementById('modal-close-btn');
    if (modalClose && modal) {
      modalClose.onclick = () => modal.classList.add('hidden');
      modal.onclick = (e) => {
        if (e.target === modal) modal.classList.add('hidden');
      };
    }
  }
}

// Instantiate and start on load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new AppController();
  window.app.init();
});
