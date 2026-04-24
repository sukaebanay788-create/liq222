(function (global) {
    const { formatPrice } = global.AppUtils;

    function updateLiquidationFeed(recentLiquidations, selectCoin) {
        const feedEl = document.getElementById('liquidationFeed');
        if (!feedEl) return;
        if (recentLiquidations.length === 0) {
            feedEl.innerHTML = '<div style="color:#848e9c;text-align:center;">Ожидание ликвидаций...</div>';
            return;
        }
        feedEl.innerHTML = recentLiquidations.map(liq => {
            const sideClass = liq.side === 'SELL' ? 'liq-side-sell' : 'liq-side-buy';
            const sideText = liq.side === 'SELL' ? 'LONG LIQ' : 'SHORT LIQ';
            return `
                <div class="liquidation-feed-item" onclick="selectCoin('${liq.symbol}')" title="Открыть график ${liq.symbol.replace('USDT', '')}">
                    <span class="liq-symbol">${liq.symbol.replace('USDT', '')}</span>
                    <span class="${sideClass}">${sideText}</span>
                    <span class="liq-volume">${(liq.volume / 1000).toFixed(0)}K</span>
                    <span>${liq.price.toFixed(2)}</span>
                </div>
            `;
        }).join('');
    }

    function createCoinRow(coin, currentSymbol, selectCoin) {
        const div = document.createElement('div');
        div.className = 'coin-item' + (coin.symbol === currentSymbol ? ' active' : '');
        div.dataset.symbol = coin.symbol;
        div.onclick = () => selectCoin(coin.symbol);
        const c24 = coin.change >= 0 ? 'positive' : 'negative';
        const c30 = coin.change30m >= 0 ? 'positive' : 'negative';
        div.innerHTML = `
            <span class="coin-symbol">${coin.symbol.replace('USDT', '')}</span>
            <span class="coin-price">${formatPrice(coin.price)}</span>
            <span class="coin-change ${c24}">${coin.change >= 0 ? '+' : ''}${coin.change.toFixed(2)}%</span>
            <span class="coin-change ${c30}">${coin.change30m >= 0 ? '+' : ''}${coin.change30m.toFixed(2)}%</span>
        `;
        return div;
    }

    function renderCoinsList(filteredCoins, currentSymbol, selectCoin) {
        const container = document.getElementById('coinsList');
        container.innerHTML = '';
        filteredCoins.forEach(c => container.appendChild(createCoinRow(c, currentSymbol, selectCoin)));
    }

    function updateCoinRow(coin) {
        const row = document.querySelector(`.coin-item[data-symbol="${coin.symbol}"]`);
        if (!row) return;
        row.children[1].textContent = formatPrice(coin.price);
        row.children[2].textContent = `${coin.change >= 0 ? '+' : ''}${coin.change.toFixed(2)}%`;
        row.children[2].className = `coin-change ${coin.change >= 0 ? 'positive' : 'negative'}`;
    }

    function updateHeader(coin, symbol, timeframe) {
        if (!coin) return;
        document.getElementById('currentSymbol').textContent = symbol + ' (' + timeframe + ')';
        document.getElementById('currentPrice').textContent = formatPrice(coin.price);
        const ch = document.getElementById('currentChange');
        const change = coin.change;
        ch.textContent = (change >= 0 ? '+' : '') + change.toFixed(2) + '%';
        ch.className = 'symbol-change ' + (change >= 0 ? 'positive' : 'negative');
    }

    function updateCoinsCount(count) {
        document.getElementById('coinsCount').textContent = count;
    }

    function updateConnectionStatus(ok, liquidationCount) {
        const el = document.getElementById('connStatus');
        el.textContent = ok ? `Connected (${liquidationCount} liq)` : 'Disconnected';
        el.className = 'connection-status ' + (ok ? 'status-connected' : 'status-disconnected');
    }

    global.AppUI = {
        updateLiquidationFeed,
        renderCoinsList,
        updateCoinRow,
        updateHeader,
        updateCoinsCount,
        updateConnectionStatus,
    };
})(window);
