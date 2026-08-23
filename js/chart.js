/**
 * MITECO Fuel Tracker - Analytics & Charts Module
 * Lightweight SVG/Canvas-based visual analytics, price distribution histogram,
 * and dynamic fuel savings calculation.
 */

class MitecoAnalytics {
  constructor(canvasContainerId = 'price-chart-container') {
    this.containerId = canvasContainerId;
  }

  /**
   * Render interactive histogram of price distribution
   */
  renderHistogram(stations, stats, fuelTypeInfo) {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (!stations || stations.length === 0 || !stats || stats.count === 0) {
      container.innerHTML = '<div class="chart-empty">No hay suficientes datos para generar la gráfica.</div>';
      return;
    }

    const prices = stations.map(s => s.currentPrice).filter(p => p !== null && !isNaN(p));
    if (prices.length === 0) return;

    const min = stats.min;
    const max = stats.max;
    const binsCount = 12;
    const step = (max - min) / binsCount || 0.01;

    const bins = Array(binsCount).fill(0);
    for (const p of prices) {
      let idx = Math.floor((p - min) / step);
      if (idx >= binsCount) idx = binsCount - 1;
      if (idx < 0) idx = 0;
      bins[idx]++;
    }

    const maxCount = Math.max(...bins, 1);
    const chartHeight = 140;
    const chartWidth = 320;

    let barsSvg = '';
    const barWidth = (chartWidth - (binsCount * 3)) / binsCount;

    bins.forEach((count, i) => {
      const heightPercent = count / maxCount;
      const barH = Math.max(4, Math.round(heightPercent * (chartHeight - 30)));
      const x = i * (barWidth + 3) + 15;
      const y = chartHeight - barH - 20;
      const priceStart = (min + i * step).toFixed(2);
      const priceEnd = (min + (i + 1) * step).toFixed(2);

      // Color gradation based on price
      let barColor = '#10b981'; // Green for cheap
      if (i > binsCount * 0.7) barColor = '#ef4444'; // Red for expensive
      else if (i > binsCount * 0.35) barColor = '#f59e0b'; // Amber for mid

      barsSvg += `
        <g class="chart-bar-group">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="3" fill="${barColor}" class="chart-bar">
            <title>${count} estaciones (${priceStart}€ - ${priceEnd}€)</title>
          </rect>
          <text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="9" fill="var(--text-muted)" class="bar-count-text">${count > 0 ? count : ''}</text>
        </g>
      `;
    });

    const svg = `
      <div class="histogram-wrapper">
        <div class="histogram-header">
          <span class="histogram-title">Distribución de Precios (${fuelTypeInfo.name})</span>
          <span class="histogram-subtitle">${stats.count} estaciones analizadas</span>
        </div>
        <svg viewBox="0 0 ${chartWidth + 30} ${chartHeight}" class="histogram-svg" preserveAspectRatio="none">
          <line x1="10" y1="${chartHeight - 19}" x2="${chartWidth + 20}" y2="${chartHeight - 19}" stroke="var(--border-color)" stroke-width="1" />
          ${barsSvg}
          <text x="15" y="${chartHeight - 6}" font-size="10" fill="var(--text-muted)">Mín: ${min.toFixed(3)}€</text>
          <text x="${(chartWidth + 30) / 2}" y="${chartHeight - 6}" text-anchor="middle" font-size="10" fill="var(--text-muted)">Media: ${stats.avg.toFixed(3)}€</text>
          <text x="${chartWidth + 15}" y="${chartHeight - 6}" text-anchor="end" font-size="10" fill="var(--text-muted)">Máx: ${max.toFixed(3)}€</text>
        </svg>
      </div>
    `;

    container.innerHTML = svg;
  }

  /**
   * Update Summary Statistics UI Elements
   */
  updateStatsCards(stats, fuelTypeInfo, cheapestStation = null) {
    const minEl = document.getElementById('stat-min-price');
    const avgEl = document.getElementById('stat-avg-price');
    const maxEl = document.getElementById('stat-max-price');
    const savingsEl = document.getElementById('stat-savings-50l');
    const countEl = document.getElementById('stat-total-count');
    const fuelLabelEl = document.getElementById('stat-fuel-label');

    if (minEl) minEl.textContent = stats && stats.min ? `${stats.min.toFixed(3)} €` : '--';
    if (avgEl) avgEl.textContent = stats && stats.avg ? `${stats.avg.toFixed(3)} €` : '--';
    if (maxEl) maxEl.textContent = stats && stats.max ? `${stats.max.toFixed(3)} €` : '--';
    if (savingsEl) savingsEl.textContent = stats && stats.savings50L ? `${stats.savings50L.toFixed(2)} €` : '0.00 €';
    if (countEl) countEl.textContent = stats && stats.count ? stats.count.toLocaleString() : '0';
    if (fuelLabelEl && fuelTypeInfo) fuelLabelEl.textContent = fuelTypeInfo.shortName;

    // Highlight top bargain card if available
    const bargainContainer = document.getElementById('top-bargain-container');
    if (bargainContainer && cheapestStation) {
      bargainContainer.innerHTML = `
        <div class="top-bargain-card">
          <div class="bargain-badge">🌟 MÁS BARATA EN ESTA BÚSQUEDA</div>
          <div class="bargain-content">
            <div class="bargain-brand">${escapeHtml(cheapestStation.rotulo)}</div>
            <div class="bargain-loc">${escapeHtml(cheapestStation.direccion)}, ${escapeHtml(cheapestStation.municipio)}</div>
            <div class="bargain-price">${cheapestStation.currentPrice.toFixed(3)} <small>€/litro</small></div>
          </div>
        </div>
      `;
    } else if (bargainContainer) {
      bargainContainer.innerHTML = '';
    }
  }
}

window.mitecoAnalytics = new MitecoAnalytics('price-chart-container');
