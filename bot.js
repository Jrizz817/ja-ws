const fs = require('fs'); // Opcional pra logs, mas mantive leve
const WebSocket = require('ws'); // npm install ws – pra client e server
const axios = require('axios'); // Pro keepalive

// Configs
const WEBSOCKET_URL = 'ws://51.81.32.143:8765'; // Cliente conecta aqui, pega dados externos
const PORT = 8080; // Server hospedado local
const KEEPALIVE_URL = 'https://dark-ws.onrender.com'; // Mude pro seu ping
const KEEPALIVE_INTERVAL = 120000; // 2 min

let wsClient; // Cliente global pro externo

// Server Hospedado na 8080
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: PORT });

function broadcast(message) {
    let sentCount = 0;
    for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify(message));
            sentCount++;
        }
    }
    console.log(`Broadcast enviado para ${sentCount} clients no server local.`);
}

wss.on('connection', (ws) => {
    console.log(`Cliente conectado ao server local. Total: ${wss.clients.size}`);
    
    ws.on('message', (data) => {
        // Handler fallback: se alguém mandar pro server, processa igual (opcional)
        const messageStr = data.toString();
        console.log(`Mensagem recebida no server local: ${messageStr.substring(0, 150)}...`);
        // Aqui você pode parsear e re-broadcast se quiser, mas pra agora, eco simples
        broadcast({ type: 'echo', data: messageStr });
    });
    
    ws.on('close', () => {
        console.log(`Cliente desconectado do server. Total: ${wss.clients.size}`);
    });
    
    ws.on('error', (error) => {
        console.error(`Erro no server: ${error.message}`);
    });
});

console.log(`Server WebSocket hospedado na porta ${PORT}. Aguardando subscribers.`);

// Cliente WebSocket: Conecta no externo, pega e processa
function connectWebSocket() {
    wsClient = new WebSocket(WEBSOCKET_URL);
    
    wsClient.on('open', () => {
        console.log(`Cliente WS conectado ao externo ${WEBSOCKET_URL}. Pronto pra caçar dados.`);
    });
    
    wsClient.on('message', (data) => {
        const messageStr = data.toString();
        console.log(`Dados recebidos do externo: ${messageStr.substring(0, 150)}...`);
        
        // Parse: Name=...&Price=...&JobID=...&Players=...
        const params = {};
        messageStr.split('&').forEach(param => {
            const [key, value] = param.split('=');
            if (key && value) params[key] = value;
        });
        
        const name = params.Name || 'Unknown';
        const priceStr = params.Price || '0.0';
        const jobId = params.JobID || 'N/A';
        const players = params.Players || 'Unknown';
        const price = parseFloat(priceStr);
        
        console.log(`Extração: Name=${name}, Price=${priceStr} (${price}), JobID=${jobId.substring(0, 20)}..., Players=${players}`);
        
        if (jobId === 'N/A' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(jobId)) {
            console.log(`JobID inválido: ${jobId}. Ignorando.`);
            return;
        }
        
        if (price < 10.0) {
            console.log(`Price <10.0: ${priceStr}. Pulando pro filtro.`);
            return;
        }
        
        console.log(`Price OK >=10.0: ${priceStr}. Criando body.`);
        
        const body = {
            animal: {
                name,
                generation: `${priceStr}M/s`
            },
            jobId,
            players
        };
        
        console.log(`Body pronto: ${JSON.stringify(body, null, 2)}`);
        
        // Em vez de API, broadcast pro server local
        broadcast(body);
    });
    
    wsClient.on('close', () => {
        console.log(`Cliente WS externo fechado. Reconectando em 5s.`);
        setTimeout(connectWebSocket, 5000);
    });
    
    wsClient.on('error', (error) => {
        console.error(`Erro no cliente WS: ${error.message}. Retry em breve.`);
    });
}

// Inicia cliente WS externo
connectWebSocket();

// Keepalive: Ping a cada 2 min
function keepalivePing() {
    console.log(`[KEEPALIVE] Pingando ${KEEPALIVE_URL}...`);
    
    axios.get(KEEPALIVE_URL, {
        timeout: 10000,
        headers: { 'User-Agent': 'WS-Hub-Keepalive/1.0' }
    }).then(res => {
        console.log(`[KEEPALIVE] Sucesso! Status ${res.status}, TS ${new Date().toISOString()}.`);
    }).catch(err => {
        if (err.code === 'ECONNABORTED') {
            console.log(`[KEEPALIVE] Timeout. Próximo vai tentar.`);
        } else {
            console.error(`[KEEPALIVE] Erro: ${err.message}. Continua rodando.`);
        }
    });
}

keepalivePing(); // Inicial
setInterval(keepalivePing, KEEPALIVE_INTERVAL);
console.log(`[KEEPALIVE] Ativado! Pings eternos a cada 2 min.`);

console.log(`Sys: Plataforma ${process.platform}, Arch ${process.arch}, Heap ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB, Node ${process.version}, PID ${process.pid}, RSS ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB.`);
