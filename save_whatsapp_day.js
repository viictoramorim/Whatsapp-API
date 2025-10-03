// save_whatsapp_day.js
// npm i whatsapp-web.js qrcode-terminal dayjs
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const dayjs = require('dayjs');

// Pega a data do argumento
if (process.argv.length < 3) {
    console.log('Uso: node save_whatsapp_day.js YYYY-MM-DD');
    process.exit(1);
}
const targetDate = process.argv[2]; // ex: 2025-10-02
const start = dayjs(targetDate).startOf('day').unix(); // timestamp em segundos
const end = dayjs(targetDate).endOf('day').unix();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: false } // mostra o navegador para evitar erros de execução
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', async () => {
    console.log('Conectado. Varredura iniciada para', targetDate);
    try {
        const chats = await client.getChats();
        const outFile = `mensagens-${targetDate}.jsonl`;

        for (const chat of chats) {
            console.log('Processando chat:', chat.name || chat.formattedTitle || chat.id._serialized);

            // busca até 1000 mensagens (ajuste se quiser mais)
            let messages = await chat.fetchMessages({ limit: 1000 });

            // filtra por data
            messages = messages.filter(m => m.timestamp >= start && m.timestamp <= end);

            if (messages.length === 0) continue;

            for (const m of messages) {
                // salva só texto
                const entry = {
                    chatId: chat.id._serialized,
                    chatTitle: chat.name || chat.formattedTitle || null,
                    from: m.from,
                    author: m.author || null,
                    timestamp: m.timestamp,
                    body: m.hasMedia ? '[MÍDIA]' : m.body
                };
                fs.appendFileSync(outFile, JSON.stringify(entry) + '\n');
            }
            console.log(' -> salvo', messages.length, 'mensagens deste chat');
        }

        console.log('Concluído. Arquivo:', outFile);
        await client.destroy();
        process.exit(0);
    } catch (err) {
        console.error('Erro durante a varredura:', err);
        await client.destroy();
        process.exit(1);
    }
});

client.initialize();
