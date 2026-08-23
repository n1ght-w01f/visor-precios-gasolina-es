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
      formatJson: false,      // json-visual mode: styled HTML developer screen
      formatPureJson: false    // json mode: raw JSON output only, no HTML at all
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
    this.renderBrandChips();
    this.bindEvents();

    // Init Map
    this.map.init();

    // Start loading data
    await this.loadData(false);

    // If format=json requested via URL, activate developer raw JSON view
    if (this.state.formatJson) {
      this.activateRawJsonMode();
    }
  }

  /**
   * Load data from API with interactive loading screen
   */
  async loadData(forceRefresh = false) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingStatus = document.getElementById('loading-status-text');
    const loadingBar = document.getElementById('loading-progress-fill');
    const lastUpdateBadge = document.getElementById('last-update-time');

    if (loadingOverlay && !this.state.formatJson && !this.state.formatPureJson) {
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
    const criteria = {
      fuelType: this.state.fuelType,
      searchText: this.state.searchText,
      brandQuery: this.state.brandQuery,
      province: this.state.province,
      municipio: this.state.municipio,
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

    // Pure JSON API mode: output raw JSON and skip all HTML rendering
    if (this.state.formatPureJson) {
      this.outputPureJson();
      return;
    }

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

    // Update live JSON API preview if modal open or in JSON mode
    this.updateApiModalContent();
    if (this.state.formatJson) {
      this.updateRawJsonScreen();
    }
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
   * Render Brand quick-filter chips
   */
  renderBrandChips() {
    const container = document.getElementById('brand-chips-container');
    if (!container) return;

    let html = '';
    window.POPULAR_BRANDS.forEach((brand) => {
      const active = this.state.brandQuery === brand.query ? 'active' : '';
      html += `
        <button class="brand-chip ${active}" data-query="${escapeHtml(brand.query)}">
          ${escapeHtml(brand.name)}
        </button>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.brand-chip').forEach(chip => {
      chip.onclick = () => {
        container.querySelectorAll('.brand-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.state.brandQuery = chip.dataset.query;
        this.applyFilters(true);
      };
    });
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
   * Update content inside Share & JSON API modal
   */
  updateApiModalContent() {
    const webInput = document.getElementById('input-shareable-web-url');
    const apiInput = document.getElementById('input-shareable-api-url');
    const openApiBtn = document.getElementById('btn-open-api-url');
    const previewPre = document.getElementById('api-json-live-preview');
    const snippetCode = document.getElementById('snippet-js-fetch');

    const params = this.buildUrlSearchParams();
    const base = window.location.origin + window.location.pathname;
    const fullWebUrl = base + (params.toString() ? '?' + params.toString() : '');

    // json-visual URL: HTML developer screen with styled JSON preview
    const visualParams = new URLSearchParams(params.toString());
    visualParams.set('format', 'json-visual');
    const fullVisualUrl = base + '?' + visualParams.toString();

    // json URL: pure JSON output — no HTML at all, usable by scripts
    const apiParams = new URLSearchParams(params.toString());
    apiParams.set('format', 'json');
    const fullApiUrl = base + '?' + apiParams.toString();

    if (webInput) webInput.value = fullWebUrl;
    // Populate visual URL field if it exists
    const visualInput = document.getElementById('input-shareable-visual-url');
    if (visualInput) visualInput.value = fullVisualUrl;
    // API field now shows the pure JSON URL
    if (apiInput) apiInput.value = fullApiUrl;
    if (openApiBtn) openApiBtn.href = fullApiUrl;

    if (this.currentDataset) {
      const payload = this.api.generateApiPayload(
        {
          fuelType: this.state.fuelType,
          searchText: this.state.searchText,
          brandQuery: this.state.brandQuery,
          province: this.state.province,
          municipio: this.state.municipio,
          only24h: this.state.only24h,
          sortBy: this.state.sortBy
        },
        this.currentDataset,
        this.state.groupBy
      );

      const jsonStr = JSON.stringify(payload, null, 2);
      if (previewPre) previewPre.textContent = jsonStr.slice(0, 3000) + (jsonStr.length > 3000 ? '\n... (truncado en previsualización)' : '');

      if (snippetCode) {
        snippetCode.textContent = `// Ejemplo de petición fetch a la API procesada:\nfetch('${fullApiUrl}')\n  .then(res => res.json())\n  .then(data => {\n    console.log('Resultados:', data.total_resultados);\n    console.log('Estadísticas:', data.estadisticas);\n    console.log('Datos:', data.datos);\n  });`;
      }
    }
  }

  /**
   * Activate the visual developer JSON screen (?format=json-visual).
   * Shows an interactive HTML page with copy buttons and a live-updating
   * JSON preview. NOT a raw API endpoint — use ?format=json for that.
   */
  activateRawJsonMode() {
    const rawScreen = document.getElementById('raw-json-screen');
    if (!rawScreen) return;
    rawScreen.classList.remove('hidden');
    this.updateRawJsonScreen();
  }

  /**
   * Pure JSON API output mode (?format=json).
   * Replaces the entire document with raw JSON text — no HTML, no CSS.
   * Usable by Python (requests.get(url).json()), curl, or any HTTP client.
   */
  outputPureJson() {
    if (!this.currentDataset) return;

    const payload = this.api.generateApiPayload(
      {
        fuelType: this.state.fuelType,
        searchText: this.state.searchText,
        brandQuery: this.state.brandQuery,
        province: this.state.province,
        municipio: this.state.municipio,
        only24h: this.state.only24h,
        sortBy: this.state.sortBy
      },
      this.currentDataset,
      this.state.groupBy
    );

    const jsonStr = JSON.stringify(payload, null, 2);

    // Replace the entire document with raw JSON text.
    // document.open() clears the document; after document.write()
    // the page contains only the JSON string with no HTML wrapper,
    // so json.loads(response.text) works in Python regardless of
    // the Content-Type header sent by the static host.
    try {
      document.open();
      document.write(jsonStr);
      document.close();
    } catch (e) {
      // Fallback: strip all page chrome and show only JSON
      document.head.innerHTML = '';
      document.body.style.cssText = 'margin:0;padding:0;white-space:pre;font-family:monospace;';
      document.body.textContent = jsonStr;
    }
  }

  /**
   * Update Raw JSON screen contents
   */
  updateRawJsonScreen() {
    const contentArea = document.getElementById('raw-json-content-area');
    const metaCount = document.getElementById('raw-json-meta-count');
    if (!contentArea || !this.currentDataset) return;

    const payload = this.api.generateApiPayload(
      {
        fuelType: this.state.fuelType,
        searchText: this.state.searchText,
        brandQuery: this.state.brandQuery,
        province: this.state.province,
        municipio: this.state.municipio,
        only24h: this.state.only24h,
        sortBy: this.state.sortBy
      },
      this.currentDataset,
      this.state.groupBy
    );

    const jsonStr = JSON.stringify(payload, null, 2);
    contentArea.textContent = jsonStr;
    if (metaCount) metaCount.textContent = `${this.currentDataset.totalMatches.toLocaleString()} registros devueltos`;
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

    this.renderBrandChips();
    this.applyFilters(true);
  }

  /**
   * Export current filtered dataset to CSV
   */
  exportToCSV() {
    if (!this.currentDataset || !this.currentDataset.allStationsForMap) return;

    const items = this.currentDataset.allStationsForMap;
    const fuelKey = this.state.fuelType;
    const fuelName = window.FUEL_TYPES[fuelKey].name;

    let csv = 'ID;Rótulo;Municipio;Provincia;Dirección;Horario;' + fuelName + ' (€);Distancia (km);Latitud;Longitud\n';
    items.forEach(s => {
      const p = s.prices[fuelKey] ? s.prices[fuelKey].toFixed(3).replace('.', ',') : '';
      csv += `"${s.id}";"${s.rotulo}";"${s.municipio}";"${s.provincia}";"${s.direccion}";"${s.horario}";"${p}";"${s.distance || ''}";"${s.lat}";"${s.lng}"\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carburantes_${fuelKey}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Export current filtered dataset to JSON
   */
  exportToJSON() {
    if (!this.currentDataset) return;

    const payload = this.api.generateApiPayload(
      {
        fuelType: this.state.fuelType,
        searchText: this.state.searchText,
        brandQuery: this.state.brandQuery,
        province: this.state.province,
        municipio: this.state.municipio,
        only24h: this.state.only24h,
        sortBy: this.state.sortBy
      },
      this.currentDataset,
      this.state.groupBy
    );

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `carburantes_${this.state.fuelType}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Geolocation helper
   */
  requestUserLocation() {
    const locBtn = document.getElementById('btn-get-location');
    if (locBtn) locBtn.innerHTML = '⌛ Localizando...';

    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización.');
      if (locBtn) locBtn.innerHTML = '📍 Mi ubicación';
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.state.userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };

        const radius = this.state.maxDistance || 25;

        // Safely set user location on map (map may not be visible in table/list view)
        this.map.setUserLocation(pos.coords.latitude, pos.coords.longitude, radius);

        // Only pan map if it is actually initialized and visible
        if (this.map.map && this.state.currentView !== 'tabla' && this.state.currentView !== 'list') {
          try {
            this.map.map.setView([pos.coords.latitude, pos.coords.longitude], 12);
          } catch (e) {
            console.warn('Map setView failed (map may not be rendered yet):', e);
          }
        }

        if (locBtn) {
          locBtn.classList.add('active');
          locBtn.innerHTML = '📍 Ubicación activa';
        }

        // Enable distance sort option
        const sortSelect = document.getElementById('select-sort-order');
        if (sortSelect) {
          const distOpt = sortSelect.querySelector('option[value="distance_asc"]');
          if (distOpt) distOpt.disabled = false;
        }

        this.applyFilters(true);
      },
      (err) => {
        // Provide specific error messages for each GeolocationPositionError code
        const messages = {
          1: 'Permiso de ubicación denegado. Haz clic en el icono del candado en la barra de direcciones y permite el acceso a la ubicación.',
          2: 'No se pudo determinar tu posición. Comprueba que el GPS o la conexión a internet funcionan correctamente.',
          3: 'La solicitud de ubicación tardó demasiado. Inténtalo de nuevo.'
        };
        const msg = messages[err.code] || `Error de geolocalización (código ${err.code}).`;
        alert('📍 ' + msg);
        console.warn('Geolocation error:', err.code, err.message);
        if (locBtn) locBtn.innerHTML = '📍 Mi ubicación';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
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

    const fmt = params.get('format');
    if (fmt === 'json') {
      // Pure JSON API mode: outputs raw JSON only, no HTML at all.
      // Consume with: requests.get(url).json() / json.loads(response.text)
      this.state.formatPureJson = true;
    } else if (fmt === 'json-visual' || fmt === 'json_visual' || params.get('output') === 'json' || params.get('json') === 'true') {
      // Visual developer mode: styled HTML screen with a JSON preview.
      this.state.formatJson = true;
    }

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

    // Geolocation Button
    const locBtn = document.getElementById('btn-get-location');
    if (locBtn) {
      locBtn.onclick = () => this.requestUserLocation();
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

    // Export Buttons
    const exportCsvBtn = document.getElementById('btn-export-csv');
    if (exportCsvBtn) exportCsvBtn.onclick = () => this.exportToCSV();

    const tableExportCsvBtn = document.getElementById('table-btn-export-csv');
    if (tableExportCsvBtn) tableExportCsvBtn.onclick = () => this.exportToCSV();

    const exportJsonBtn = document.getElementById('btn-export-json');
    if (exportJsonBtn) exportJsonBtn.onclick = () => this.exportToJSON();

    const tableExportJsonBtn = document.getElementById('table-btn-export-json');
    if (tableExportJsonBtn) tableExportJsonBtn.onclick = () => this.exportToJSON();

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

    // Copy Buttons inside API Modal
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

    const copyApiBtn = document.getElementById('btn-copy-api-url');
    if (copyApiBtn) {
      copyApiBtn.onclick = () => {
        const input = document.getElementById('input-shareable-api-url');
        if (input) {
          navigator.clipboard.writeText(input.value);
          copyApiBtn.textContent = '✓ ¡Copiado!';
          setTimeout(() => copyApiBtn.textContent = '📋 Copiar API URL', 2000);
        }
      };
    }

    // Raw JSON Mode Screen Buttons
    const rawCopyBtn = document.getElementById('btn-raw-json-copy');
    if (rawCopyBtn) {
      rawCopyBtn.onclick = () => {
        const content = document.getElementById('raw-json-content-area');
        if (content) {
          navigator.clipboard.writeText(content.textContent);
          rawCopyBtn.textContent = '✓ ¡Copiado!';
          setTimeout(() => rawCopyBtn.textContent = '📋 Copiar JSON', 2000);
        }
      };
    }

    const rawDownloadBtn = document.getElementById('btn-raw-json-download');
    if (rawDownloadBtn) {
      rawDownloadBtn.onclick = () => this.exportToJSON();
    }

    const rawSwitchUiBtn = document.getElementById('btn-raw-json-switch-ui');
    if (rawSwitchUiBtn) {
      rawSwitchUiBtn.onclick = () => {
        const rawScreen = document.getElementById('raw-json-screen');
        if (rawScreen) rawScreen.classList.add('hidden');
        this.state.formatJson = false;
        this.updateUrlParams();
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
