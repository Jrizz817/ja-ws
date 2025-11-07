const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const WebSocket = require('ws'); // Dependência: npm install ws
const axios = require('axios'); // Pro keepalive

const client = new Client({
    checkUpdate: false,
    syncStatus: true
});

const monitoredChannels = ['1423810129572270180', '1424420056992845897', '1426620552407416973'];
const NEW_CHANNEL_ID = '1426620552407416973';
const USER_TOKEN = 'MTAxMzI0MTg0OTg3MzQzMjY0Nw.Gg1Cna.OdrJ-LQzpMdFjHAlunQc33ZUv3sQisocoCRgEg';

// Keepalive config
const KEEPALIVE_URL = 'https://httpbin.org/get'; // Mude pra sua URL de ping
const KEEPALIVE_INTERVAL = 120000; // 2 minutos em ms

// Configuração do WebSocket Server
const { WebSocketServer } = require('ws');
const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

function broadcast(message) {
    for (const wsClient of wss.clients) {
        if (wsClient.readyState === wsClient.OPEN) {
            wsClient.send(JSON.stringify(message));
        }
    }
}

wss.on('connection', (ws) => {
    console.log(`Cliente WebSocket conectado. Total de clientes: ${wss.clients.size}`);
    
    ws.on('message', (data) => {
        const messageStr = data.toString();
        console.log(`Mensagem recebida via WebSocket: ${messageStr.substring(0, 150)}...`);
        
        // Parse params from string like: Name=...&Price=...&JobID=...&Players=...
        const params = {};
        messageStr.split('&').forEach(param => {
            const [key, value] = param.split('=');
            if (key && value) {
                params[key] = value;
            }
        });
        
        const name = params.Name || 'UnknownWebsocket';
        const priceStr = params.Price || '0.0';
        const jobId = params.JobID || 'N/A';
        const players = params.Players || 'Unknown';
        const price = parseFloat(priceStr);
        
        console.log(`Extração WebSocket: Name=${name}, Price=${priceStr} (${price}), JobID=${jobId.substring(0, 20)}..., Players=${players}`);
        
        if (jobId === 'N/A' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(jobId)) {
            console.log(`JobID inválido: ${jobId}. Ignorando.`);
            return;
        }
        
        if (price < 10.0) {
            console.log(`Price abaixo de 10.0: ${priceStr}. Ignorando.`);
            return;
        }
        
        console.log(`Price >=10.0: ${priceStr}! Prosseguindo.`);
        
        // Body principal com players no raiz
        const body = {
            animal: {
                name,
                generation: `${priceStr}M/s`
            },
            jobId,
            players
        };
        
        console.log(`Body principal com players: ${JSON.stringify(body, null, 2)}`);
        
        // Broadcast para clientes conectados
        broadcast(body);
    });
    
    ws.on('close', () => {
        console.log(`Cliente WebSocket desconectado. Total de clientes: ${wss.clients.size}`);
    });
    
    ws.on('error', (error) => {
        console.error(`Erro no WebSocket: ${error.message}`);
    });
});

console.log(`Servidor WebSocket ativo na porta ${PORT}`);

// Função para broadcast genérica
function broadcastToWs(body, source = 'discord') {
    console.log(`Broadcast via ${source}: ${JSON.stringify(body, null, 2)}`);
    broadcast(body);
}

// Sistema de Keepalive: Ping a cada 2 min
function keepalivePing() {
    console.log(`[KEEPALIVE] Iniciando ping pra ${KEEPALIVE_URL}...`);
    
    axios.get(KEEPALIVE_URL, {
        timeout: 10000,
        headers: {
            'User-Agent': 'Keepalive-Bot/1.0 (Node.js)'
        }
    })
    .then(response => {
        console.log(`[KEEPALIVE] Ping OK! Status: ${response.status}, Tempo: ${Date.now()}. Bot vivo e forte.`);
    })
    .catch(error => {
        if (error.code === 'ECONNABORTED') {
            console.log(`[KEEPALIVE] Timeout no ping. Retry no próximo ciclo.`);
        } else {
            console.error(`[KEEPALIVE] Erro no ping: ${error.message}. Loop continua implacável.`);
        }
    });
}

client.on('ready', () => {
    console.log(`Selfbot online como ${client.user.tag}! Monitorando canais.`);
    console.log(`Aviso: Selfbots violam ToS do Discord. Use no seu risco.`);
    console.log(`Sys info: Node ${process.version}, PID ${process.pid}, Plataforma ${process.platform}, Memória inicial ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB.`);
    
    let interval = 8000 + Math.random() * 62000;
    setInterval(() => {
        const activities = [{ name: 'vigilando canais + WebSocket server', type: 'LISTENING' }];
        client.user.setPresence({ activities });
        console.log(`Presence atualizada. TS: ${new Date().toISOString()}. Próximo: ~${Math.round(interval/1000)}s`);
        interval = 8000 + Math.random() * 62000;
    }, interval);
});

client.on('messageCreate', async (message) => {
    const channelId = message.channel.id;
    if (!monitoredChannels.includes(channelId)) return;
    if (message.author.id === client.user.id) return;
    if (!message.embeds.length) return;

    const embed = message.embeds[0];
    const embedText = (embed.description || '') + '\n' + (embed.fields ? embed.fields.map(f => (f.name ? `${f.name}: ${f.value}` : f.value)).join('\n') : '');

    console.log(`Embed recebido no canal ${channelId}! Msg ID: ${message.id}.`);

    let moneyMatch, jobMatch, nameMatch;
    let moneyRaw, money;
    let isNewFormat = (channelId === NEW_CHANNEL_ID);
    let jobId;

    if (isNewFormat) {
        console.log(`Canal novo detectado ${NEW_CHANNEL_ID}! Regex para "Highest Animal".`);
        
        moneyMatch = embedText.match(/\*\*Generation:\*\*\s*\$([0-9,]+\.?[0-9]*M?\/s)/i) || embedText.match(/Generation:\s*\$([0-9,]+\.?[0-9]*M?\/s)/i);
        moneyRaw = moneyMatch ? moneyMatch[1] : '0M/s';
        money = moneyRaw.replace(/^\$|,/g, '');

        function parseMoney(moneyStr) {
            let num = parseFloat(moneyStr.replace(/,/g, '').replace('M/s', ''));
            if (moneyStr.includes('M')) num *= 1000000;
            return num;
        }

        const moneyNum = parseMoney(moneyRaw);

        if (moneyNum < 10000000 || moneyNum > 10000000000) {
            const reason = moneyNum < 10000000 ? 'abaixo 10M' : 'acima 10B';
            console.log(`Geração fora do range no canal ${channelId}: ${moneyRaw} (${reason}). Ignorando.`);
            return;
        }

        console.log(`Geração válida: ${moneyRaw} (dentro de 10M-10B)!`);

        jobMatch = embedText.match(/TeleportToPlaceInstance\s*\(\s*[0-9]+,\s*'([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})'/i);

        nameMatch = embedText.match(/Highest\s*(?:est)?\s*Animal\s*Found!/i);
        if (nameMatch) {
            nameMatch = {1: nameMatch[0].trim()};
        }
    } else {
        console.log(`Canal antigo ${channelId}! Usando regex clássica.`);
        
        moneyMatch = embedText.match(/\$([0-9,]+\.?[0-9]*M?\/s)/);
        moneyRaw = moneyMatch ? moneyMatch[1] : '0M/s';
        money = moneyRaw.replace(/^\$|,/g, '');

        jobMatch = embedText.match(/Job\s*ID\s*:\s*```?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})```?/i);

        nameMatch = embedText.match(/🔥\s*([^-]+)\s*-\s*/);
    }

    jobId = jobMatch ? jobMatch[1] : 'N/A';
    if (jobId !== 'N/A' && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(jobId)) {
        console.log(`Job ID inválido no ${channelId}: ${jobId.substring(0,20)}...`);
        jobId = 'INVALID';
    }

    const name = nameMatch ? nameMatch[1].trim() : (isNewFormat ? 'Unknown' : 'Embed');

    if (money === '0M/s' || jobId === 'N/A') {
        console.log(`Extração falhou no ${channelId}.`);
        const failedBody = { animal: { name, generation: money }, jobId };
        fs.writeFileSync(`falha_${channelId}_${message.id}.json`, JSON.stringify({ embedText, channelId, timestamp: new Date().toISOString(), isNewFormat, failedBody }, null, 2));
        console.log(`Dados salvos em falha_${channelId}_${message.id}.json.`);
        return;
    }

    // Body principal com players no raiz
    const body = {
        animal: {
            name,
            generation: money
        },
        jobId,
        players: 'Unknown'
    };

    console.log(`Body principal com players: ${JSON.stringify(body, null, 2)}`);

    // Broadcast para WebSocket
    broadcastToWs(body, channelId);
});

client.login(USER_TOKEN).then(() => {
    console.log(`Logado com sucesso! Monitorando canais e servidor WebSocket ativo.`);
    // Inicia keepalive 30s após login
    setTimeout(() => {
        keepalivePing(); // Ping inicial
        setInterval(keepalivePing, KEEPALIVE_INTERVAL); // Loop a cada 2 min
        console.log(`[KEEPALIVE] Sistema ativado! Próximo ping em 2 min. Imortalidade garantida.`);
    }, 30000);
}).catch(err => {
    console.error(`Erro no login: ${err.message}. Verifique o token.`);
});

console.log(`Sys info: Plataforma ${process.platform}, Arch ${process.arch}, Heap ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB, Node ${process.version}, PID ${process.pid}, Memória ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB.`);
