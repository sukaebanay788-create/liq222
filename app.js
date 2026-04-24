function connectLiquidationWebSocket() {
    // ... ваш код очистки предыдущих соединений ...
    
    try {
        // Временно используем порт 9443 и пустую строку стрима
        liquidationWs = new WebSocket(`${BINANCE_WS_PUBLIC}:9443/ws`);

        function resetHeartbeat() {
            if (liquidationHeartbeat) clearTimeout(liquidationHeartbeat);
            liquidationHeartbeat = setTimeout(() => {
                console.warn('No data for 80s, reconnecting...');
                connectLiquidationWebSocket();
            }, LIQUIDATION_TIMEOUT);
        }

        liquidationWs.onopen = () => {
            console.log('Liquidation WebSocket connected. Subscribing...');
            // Отправляем запрос на подписку вместо использования URL
            liquidationWs.send(JSON.stringify({
                method: 'SUBSCRIBE',
                params: ['!forceOrder@arr'],
                id: Date.now()
            }));
            resetHeartbeat();
        };

        // ... ваш код onmessage, onclose, onerror ...
    } catch (error) {
        // ... обработка ошибок ...
    }
}
