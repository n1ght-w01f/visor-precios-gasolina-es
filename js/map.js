/**
 * MITECO Fuel Tracker - Map & Leaflet Visualization Module
 * Handles map initialization, custom SVG price pins, marker clustering,
 * interactive popups with direct navigation shortcuts, and bounds auto-fitting.
 */

class MitecoMap {
  constructor(mapContainerId = 'fuel-map') {
    this.containerId = mapContainerId;
    this.map = null;
    this.markersGroup = null;
    this.userMarker = null;
    this.userCircle = null;
    this.currentMarkers = new Map(); // id -> L.Marker
    this.isInitialized = false;
  }

  /**
   * Initialize Leaflet map instance
   */
  init(defaultCenter = [40.4168, -3.7038], defaultZoom = 6) {
    if (this.isInitialized) return;

    const mapEl = document.getElementById(this.containerId);
    if (!mapEl) return;

    // Create Leaflet map with CartoDB Positron / Voyager clean tiles
    this.map = L.map(this.containerId, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: false,
      attributionControl: false
    });

    // Custom modern zoom control in top-right
    L.control.zoom({ position: 'topright' }).addTo(this.map);

    // Modern light base tile layer with dark mode filter compatibility
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(this.map);

    // Initialize MarkerClusterGroup with custom styling
    this.markersGroup = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        let size = 'small';
        if (count > 50) size = 'medium';
        if (count > 200) size = 'large';
        return L.divIcon({
          html: `<div class="fuel-cluster fuel-cluster-${size}"><span>${count}</span></div>`,
          className: 'custom-cluster-icon',
          iconSize: L.point(40, 40)
        });
      }
    });

    this.map.addLayer(this.markersGroup);
    this.isInitialized = true;

    // Handle container resize gracefully
    setTimeout(() => {
      this.map.invalidateSize();
    }, 200);
  }

  /**
   * Determine marker color badge relative to price pool
   */
  getPriceTier(price, stats) {
    if (!stats || !stats.p25 || !stats.p75) return 'normal';
    if (price <= stats.p25) return 'cheap'; // Top 25% cheapest (Green)
    if (price >= stats.p75) return 'expensive'; // Top 25% most expensive (Red)
    return 'medium'; // Middle tier (Yellow/Amber)
  }

  /**
   * Create custom HTML / SVG Marker icon with price badge
   */
  createPriceMarkerIcon(station, fuelTypeInfo, tier) {
    const priceFormatted = station.currentPrice ? station.currentPrice.toFixed(3) + '€' : '--';
    const tierClass = `tier-${tier}`;
    
    // Clean, modern floating pin with price tag
    const html = `
      <div class="custom-station-pin ${tierClass}" id="pin-${station.id}">
        <div class="pin-badge">
          <span class="pin-price">${priceFormatted}</span>
        </div>
        <div class="pin-tail"></div>
      </div>
    `;

    return L.divIcon({
      html: html,
      className: 'fuel-pin-wrapper',
      iconSize: [60, 34],
      iconAnchor: [30, 34],
      popupAnchor: [0, -32]
    });
  }

  /**
   * Generate popup HTML for station
   */
  createPopupContent(station, fuelTypeInfo, onFavoriteToggle) {
    const isFav = window.favoritesManager ? window.favoritesManager.isFavorite(station.id) : false;
    const favIcon = isFav ? '★' : '☆';
    const favClass = isFav ? 'active' : '';

    // Fuel price pills
    let fuelListHtml = '<div class="popup-fuels-grid">';
    for (const [key, fuel] of Object.entries(window.FUEL_TYPES)) {
      const price = station.prices[key];
      if (price !== null && price !== undefined) {
        const isCurrentFuel = key === fuelTypeInfo.id;
        fuelListHtml += `
          <div class="popup-fuel-pill ${isCurrentFuel ? 'highlighted' : ''}">
            <span class="fuel-label">${fuel.shortName}</span>
            <span class="fuel-val">${price.toFixed(3)} €</span>
          </div>
        `;
      }
    }
    fuelListHtml += '</div>';

    // Google Maps & Waze Navigation URLs
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;
    const wazeUrl = `https://waze.com/ul?ll=${station.lat},${station.lng}&navigate=yes`;

    return `
      <div class="station-popup-card">
        <div class="popup-header">
          <div class="popup-brand-badge">${escapeHtml(station.rotulo)}</div>
          <button class="popup-fav-btn ${favClass}" data-id="${station.id}" title="Guardar en favoritas">
            ${favIcon}
          </button>
        </div>

        <div class="popup-price-hero">
          <span class="popup-fuel-type">${escapeHtml(fuelTypeInfo.name)}</span>
          <span class="popup-hero-price">${station.currentPrice ? station.currentPrice.toFixed(3) : '--'} <small>€/L</small></span>
        </div>

        <div class="popup-info-rows">
          <div class="popup-info-row">
            <svg class="popup-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            <span>${escapeHtml(station.direccion)}, <strong>${escapeHtml(station.municipio)}</strong> (${escapeHtml(station.provincia)})</span>
          </div>
          <div class="popup-info-row">
            <svg class="popup-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${escapeHtml(station.horario || 'Horario no especificado')} ${station.is24h ? '<span class="badge-24h">24H</span>' : ''}</span>
          </div>
          ${station.distance !== null ? `
          <div class="popup-info-row">
            <svg class="popup-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
            <span>A <strong>${station.distance} km</strong> de tu ubicación</span>
          </div>
          ` : ''}
        </div>

        <div class="popup-fuels-section">
          <div class="popup-section-title">Todos los combustibles disponibles:</div>
          ${fuelListHtml}
        </div>

        <div class="popup-actions">
          <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-nav-action btn-maps">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
            Google Maps
          </a>
          <a href="${wazeUrl}" target="_blank" rel="noopener noreferrer" class="btn-nav-action btn-waze">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 12h8"></path></svg>
            Waze
          </a>
        </div>
      </div>
    `;
  }

  /**
   * Update map markers with new stations dataset
   */
  renderStations(stations, fuelTypeInfo, stats, autoFit = false) {
    if (!this.map || !this.markersGroup) return;

    this.markersGroup.clearLayers();
    this.currentMarkers.clear();

    const validLatLngs = [];

    // Limit map pins to 1000 at a time for maximum smoothness
    const maxPins = Math.min(stations.length, 1000);

    for (let i = 0; i < maxPins; i++) {
      const s = stations[i];
      if (!s.hasCoords) continue;

      const tier = this.getPriceTier(s.currentPrice, stats);
      const icon = this.createPriceMarkerIcon(s, fuelTypeInfo, tier);

      const marker = L.marker([s.lat, s.lng], {
        icon: icon,
        title: `${s.rotulo} - ${s.currentPrice.toFixed(3)}€`
      });

      // Bind rich popup
      marker.bindPopup(() => this.createPopupContent(s, fuelTypeInfo), {
        maxWidth: 320,
        className: 'station-custom-leaflet-popup'
      });

      marker.on('popupopen', () => {
        // Wire popup favorite button
        const btn = document.querySelector(`.popup-fav-btn[data-id="${s.id}"]`);
        if (btn && window.favoritesManager) {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nowFav = window.favoritesManager.toggleFavorite(s.id);
            btn.innerHTML = nowFav ? '★' : '☆';
            btn.classList.toggle('active', nowFav);
            if (window.app) window.app.onFavoritesChanged();
          });
        }
      });

      this.markersGroup.addLayer(marker);
      this.currentMarkers.set(s.id, marker);
      validLatLngs.push([s.lat, s.lng]);
    }

    if (autoFit && validLatLngs.length > 0) {
      this.map.fitBounds(validLatLngs, {
        padding: [40, 40],
        maxZoom: 14
      });
    }
  }

  /**
   * Pan to station and open popup
   */
  flyToStation(station) {
    if (!this.map || !station || !station.hasCoords) return;

    this.map.setView([station.lat, station.lng], 15, { animate: true });

    const marker = this.currentMarkers.get(station.id);
    if (marker) {
      setTimeout(() => {
        marker.openPopup();
      }, 300);
    }
  }

  /**
   * Set user location marker and circle radius
   */
  setUserLocation(lat, lng, radiusKm = null) {
    if (!this.map) return;

    if (this.userMarker) this.map.removeLayer(this.userMarker);
    if (this.userCircle) this.map.removeLayer(this.userCircle);

    // User position pulse icon
    const userIcon = L.divIcon({
      html: '<div class="user-pulse-marker"><div class="pulse-ring"></div><div class="pulse-dot"></div></div>',
      className: 'user-marker-wrapper',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    this.userMarker = L.marker([lat, lng], { icon: userIcon }).addTo(this.map);
    this.userMarker.bindTooltip('Tu ubicación actual', { permanent: false, direction: 'top' });

    if (radiusKm) {
      this.userCircle = L.circle([lat, lng], {
        radius: radiusKm * 1000,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.1,
        weight: 1.5,
        dashArray: '4, 6'
      }).addTo(this.map);
    }
  }

  /**
   * Trigger resize when layout shifts
   */
  invalidateSize() {
    if (this.map) {
      this.map.invalidateSize();
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.mitecoMap = new MitecoMap('fuel-map');
