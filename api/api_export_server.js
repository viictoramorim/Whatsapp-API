// api_export_terminal_qr.js
// npm i whatsapp-web.js qrcode-terminal dayjs express puppeteer

const express = require('express');
const fs = require('fs');
const dayjs = require('dayjs');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = process.env.PORT || 3000;

let isReady = false;

// Configuração do Cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: 'export_api_session',
    // NOVIDADE: Mover o armazenamento da sessão para uma subpasta dedicada
    dataPath: './.session_data' 
}), 
  puppeteer: {
    headless: false, // Mantido como false para visualização (opcionalmente mude para true)
    slowMo: 100, // Pequeno delay para estabilizar a injeção do script do whatsapp-web.js
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-device-discovery-notifications',
        '--disable-gpu',
        '--single-process'
    ]
  }
});

client.on('qr', qr => {
  console.log('---- QR (terminal) ----');
  qrcode.generate(qr, { small: true });
  console.log('-----------------------\nEscaneie com WhatsApp → Dispositivos conectados → Conectar dispositivo');
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado (sessão pronta).');
  isReady = true;
});

client.on('auth_failure', (msg) => {
  console.error('Falha de autenticação. Tente excluir a pasta de sessão (.session_data) e escanear o QR novamente.', msg);
  isReady = false;
});

client.on('disconnected', (reason) => {
  console.log('Desconectado:', reason);
  isReady = false;
});

client.initialize();

// Middleware para servir arquivos estáticos (como export_interface.html)
app.use(express.static(__dirname));

// status
app.get('/status', (req, res) => {
  res.json({ ready: isReady });
});

// NOVO ENDPOINT: Lista todos os chats e seus IDs
app.get('/chats', async (req, res) => {
    if (!isReady) return res.status(400).send('Cliente não está pronto. Escaneie o QR no terminal.');
    
    try {
        const chats = await client.getChats();
        // Filtra para mostrar apenas contatos e grupos relevantes (removendo "Status" e outros chats internos)
        const chatList = chats
            .filter(chat => !chat.isStatusV3)
            .map(chat => ({
                id: chat.id._serialized,
                name: chat.name || chat.formattedTitle || 'N/A',
                isGroup: chat.isGroup
            }));
        res.json(chatList);
    } catch (err) {
        console.error('Erro ao listar chats:', err);
        res.status(500).send('Erro interno ao buscar lista de chats.');
    }
});


// exporta mensagens por data E (opcionalmente) por contato
app.get('/export', async (req, res) => {
  if (!isReady) return res.status(400).send('Cliente não está pronto. Escaneie o QR no terminal.');
  
  const date = req.query.date;
  const targetChatId = req.query.chatId; // Novo parâmetro opcional: o ID do contato/chat (ex: 55XXYYYYYYYYY@c.us)
  
  if (!date) return res.status(400).send('Passe ?date=YYYY-MM-DD');

  const start = dayjs(date).startOf('day').unix();
  const end = dayjs(date).endOf('day').unix();
  
  let chatsToProcess = [];
  let outFile = `mensagens-${date}`;

  // Lógica de Filtragem de Chat
  try {
    if (targetChatId) {
      // 1. Exporta apenas o chat específico
      res.write(`Buscando chat específico: ${targetChatId}...\n`);
      const chat = await client.getChatById(targetChatId);
      
      if (!chat) {
        return res.status(404).send(`Chat com ID ${targetChatId} não encontrado. Certifique-se de usar o formato 55XXYYYYYYYYY@c.us.`);
      }
      chatsToProcess.push(chat);
      // Nomeia o arquivo com parte do número para fácil identificação
      outFile += `-${targetChatId.split('@')[0]}`; 
    } else {
      // 2. Comportamento original: Exporta todos os chats
      res.write('Buscando todos os chats...\n');
      chatsToProcess = await client.getChats();
    }
  } catch (err) {
    console.error('Erro ao buscar chat(s):', err);
    return res.status(500).send('Erro interno ao buscar chats: ' + String(err));
  }

  outFile += '.jsonl';

  res.write(`Encontrados ${chatsToProcess.length} chat(s) para processar. Iniciando varredura...\n`);

  // remove arquivo antigo
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

  for (const chat of chatsToProcess) {
        // Pequeno atraso para evitar ser bloqueado ao iterar por muitos chats
        await new Promise(resolve => setTimeout(resolve, 500)); 

      res.write(`Processando: ${chat.name || chat.formattedTitle || chat.id._serialized}\n`);
      
      // Pega as últimas 1000 mensagens. Se o dia for muito antigo, será necessário 
      // implementar paginação avançada.
      let messages = await chat.fetchMessages({ limit: 1000 });
      
      // filtra por data exata (timestamp em segundos)
      messages = messages.filter(m => m.timestamp >= start && m.timestamp <= end);

      if (messages.length === 0) {
        continue;
      }

      for (const m of messages) {
        const entry = {
          chatId: chat.id._serialized,
          chatTitle: chat.name || chat.formattedTitle || null,
          from: m.from,
          author: m.author || null,
          timestamp: m.timestamp,
          body: m.hasMedia ? '[MÍDIA]' : (m.body || '')
        };
        fs.appendFileSync(outFile, JSON.stringify(entry) + '\n');
      }

      res.write(` -> salvo ${messages.length} mensagens deste chat\n`);
    }

    res.write(`Concluído. Arquivo salvo: ${outFile}\n`);
    res.end();
});

// Adiciona rota raiz para servir a interface diretamente
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/export_interface.html');
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
  console.log(`Interface Simplificada: http://localhost:${PORT}`);
});
