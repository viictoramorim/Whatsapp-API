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

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: false, // NÃO abre janela visível
    args: ['--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-device-discovery-notifications']
    // Se der problema com headless, troque para headless: false temporariamente
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
  console.error('Falha de autenticação:', msg);
  isReady = false;
});

client.on('disconnected', (reason) => {
  console.log('Desconectado:', reason);
  isReady = false;
});

client.initialize();

// status
app.get('/status', (req, res) => {
  res.json({ ready: isReady });
});

// exporta mensagens por data (chamada por curl ou navegador)
app.get('/export', async (req, res) => {
  if (!isReady) return res.status(400).send('Cliente não está pronto. Escaneie o QR no terminal.');
  const date = req.query.date;
  if (!date) return res.status(400).send('Passe ?date=YYYY-MM-DD');

  const start = dayjs(date).startOf('day').unix();
  const end = dayjs(date).endOf('day').unix();
  const outFile = `mensagens-${date}.jsonl`;

  // stream de resposta para ver progressos no navegador/curl
  res.write(`Iniciando exportação para ${date}...\n`);

  try {
    const chats = await client.getChats();
    res.write(`Encontrados ${chats.length} chats. Iniciando varredura...\n`);

    // remove arquivo antigo
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

    for (const chat of chats) {
      res.write(`Processando: ${chat.name || chat.formattedTitle || chat.id._serialized}\n`);
      // pega as últimas 1000 mensagens (se o dia for muito antigo, precisamos ajustar/implementar paginação)
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

    res.write(`Concluído. Arquivo: ${outFile}\n`);
    res.end();
  } catch (err) {
    console.error('Erro na exportação:', err);
    res.status(500).send('Erro interno: ' + String(err));
  }
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT} — use /status e /export?date=YYYY-MM-DD`);
});
