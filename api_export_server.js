// api_export_server.js
// Uso: node api_export_server.js
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
    headless: false,                 // mostra o navegador para você escanear e acompanhar
    args: ['--no-sandbox','--disable-setuid-sandbox'],
    // se tiver problemas de chromium, descomente e ajuste a linha abaixo para o caminho do seu Chrome:
    // executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  }
});

client.on('qr', qr => {
  console.log('QR gerado — escaneie com WhatsApp (Dispositivos conectados -> Conectar dispositivo):');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ WhatsApp conectado e pronto.');
  isReady = true;
});

client.on('auth_failure', msg => {
  console.error('Falha de autenticação:', msg);
  isReady = false;
});

client.on('disconnected', reason => {
  console.log('Desconectado:', reason);
  isReady = false;
});

client.initialize();

// endpoint de status
app.get('/status', (req, res) => {
  res.json({ ready: isReady });
});

// endpoint para exportar mensagens do dia
app.get('/export', async (req, res) => {
  if (!isReady) return res.status(400).send('Cliente não está pronto. Escaneie o QR primeiro.');

  const date = req.query.date;
  if (!date) return res.status(400).send('Passe ?date=YYYY-MM-DD');

  const start = dayjs(date).startOf('day').unix();
  const end = dayjs(date).endOf('day').unix();
  const outFile = `mensagens-${date}.jsonl`;

  res.write(`Iniciando exportação para ${date}...\n`);
  try {
    const chats = await client.getChats();
    res.write(`Encontrados ${chats.length} chats. Iniciando varredura...\n`);

    // apaga arquivo antigo se existir
    if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

    for (const chat of chats) {
      res.write(`Processando chat: ${chat.name || chat.formattedTitle || chat.id._serialized}\n`);
      // pega até 1000 mensagens recentes (pode ajustar)
      let messages = await chat.fetchMessages({ limit: 1000 });
      // filtra por data
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
    res.status(500).send('Erro interno: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`API de exportação rodando em http://localhost:${PORT}`);
});
