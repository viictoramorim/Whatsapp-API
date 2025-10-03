// save_whatsapp_day.js
// npm i whatsapp-web.js qrcode-terminal dayjs fs
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const dayjs = require('dayjs');

if (process.argv.length < 3) {
    console.log('Uso: node save_whatsapp_day.js YYYY-MM-DD');
    process.exit(1);
}

const targetDate = process.argv[2]; // ex: 2025-10-02
const start = dayjs(targetDate).startOf('day').unix(); // timestamp em segundos
const end = dayjs(targetDate).endOf('day').unix();

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox'] }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', async () => {
    console.log('✅ WhatsApp conectado! Varredura iniciada para', targetDate);

    try {
        const chats = await client.getChats();
        const outFile = `mensagens-${targetDate}.jsonl`;
        console.log('📁 Processando', chats.length, 'chats...');

        for (const chat of chats) {
            console.log('🔹 Chat:', chat.name || chat.formattedTitle || chat.id._serialized);
            let allMessages = [];
            let lastId = null;

            // Paginação automática
            while (true) {
                const opts = lastId ? { limit: 1000, before: lastId } : { limit: 1000 };
                const msgs = await chat.fetchMessages(opts);
                if (!msgs || msgs.length === 0) break;

                allMessages = allMessages.concat(msgs);
                lastId = msgs[msgs.length - 1].id._serialized;

                // Para não continuar indefinidamente
                if (msgs[msgs.length - 1].timestamp < start) break;
            }

            // Filtra por data
            const filtered = allMessages.filter(m => m.timestamp >= start && m.timestamp <= end);

            if (filtered.length === 0) continue;

            for (const m of filtered) {
                if (m.hasMedia) {
                    // Ignora download de mídia, mas salva metadados
                    fs.appendFileSync(outFile, JSON.stringify({
                        chatTitle: chat.name || chat.formattedTitle,
                        from: m.from,
                        timestamp: m.timestamp,
                        hasMedia: true
                    }) + '\n');
                } else {
                    fs.appendFileSync(outFile, JSON.stringify({
                        chatTitle: chat.name || chat.formattedTitle,
                        from: m.from,
                        body: m.body,
                        timestamp: m.timestamp
                    }) + '\n');
                }
            }

            console.log('   -> salvo', filtered.length, 'mensagens deste chat');
        }

        console.log('🎉 Concluído! Arquivo:', outFile);
        await client.destroy();
        process.exit(0);

    } catch (err) {
        console.error('❌ Erro durante a varredura:', err);
        await client.destroy();
        process.exit(1);
    }
});

client.initialize();
