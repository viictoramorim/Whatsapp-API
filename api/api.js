// api.js
// API simples do WhatsApp (Node.js + Express + whatsapp-web.js)

const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const dayjs = require("dayjs");

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializa cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true } // sem abrir navegador
});

// Exibe QR Code no console só na primeira vez
client.on("qr", qr => {
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ WhatsApp conectado!");
});

// Endpoint de teste
app.get("/", (req, res) => {
  res.send("API do WhatsApp rodando ✅");
});

// Endpoint: buscar mensagens de um dia
app.get("/messages", async (req, res) => {
  try {
    const date = req.query.date; // ?date=YYYY-MM-DD
    if (!date) return res.status(400).send("Passe ?date=YYYY-MM-DD");

    const start = dayjs(date).startOf("day").unix();
    const end = dayjs(date).endOf("day").unix();

    let result = [];

    const chats = await client.getChats();
    for (const chat of chats) {
      let messages = await chat.fetchMessages({ limit: 500 });
      messages = messages.filter(m => m.timestamp >= start && m.timestamp <= end);

      for (const m of messages) {
        if (!m.hasMedia) {
          result.push({
            chatTitle: chat.name || chat.formattedTitle,
            from: m.from,
            body: m.body,
            timestamp: m.timestamp
          });
        }
      }
    }

    res.json(result);
  } catch (err) {
    console.error("Erro:", err);
    res.status(500).send("Erro interno");
  }
});

// Inicia cliente e servidor
client.initialize();
app.listen(PORT, () => {
  console.log("🚀 API rodando na porta " + PORT);
});
