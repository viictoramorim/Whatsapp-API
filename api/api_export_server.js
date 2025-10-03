// api_export_terminal_qr.js
// npm i whatsapp-web.js qrcode-terminal dayjs express puppeteer

const express = require('express');
const fs = require('fs');
const dayjs = require('dayjs');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Adiciona o plugin para formatar o timestamp de forma legível
const customParseFormat = require('dayjs/plugin/customParseFormat');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const app = express();
const PORT = process.env.PORT || 3000;

let isReady = false;

// Configuração do Cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: 'export_api_session',
    // Mover o armazenamento da sessão para uma subpasta dedicada
    dataPath: './.session_data' 
}), 
  puppeteer: {
    headless: false,
    slowMo: 100, 
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

// Endpoint: Lista todos os chats e seus IDs
app.get('/chats', async (req, res) => {
    if (!isReady) return res.status(400).send('Cliente não está pronto. Escaneie o QR no terminal.');
    
    try {
        const chats = await client.getChats();
        // Filtra para mostrar apenas contatos e grupos relevantes
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


// exporta mensagens por data e por contato (e agora força o download do TXT)
app.get('/export', async (req, res) => {
  if (!isReady) return res.status(400).send('Cliente não está pronto. Escaneie o QR no terminal.');
  
  const date = req.query.date;
  const targetChatId = req.query.chatId;
  
  if (!date) return res.status(400).send('Passe ?date=YYYY-MM-DD');

    // Inicio do bloco TRY principal para toda a lógica de exportação
    try { 
        const start = dayjs(date).startOf('day').unix();
        const end = dayjs(date).endOf('day').unix();
        
        let chatsToProcess = [];
        let chatTitle = 'MultiplosChats'; // Título padrão
        let fileNameBase = `${date}`;

        // Lógica de Filtragem de Chat
        if (targetChatId) {
            // Chat específico
            console.log(`[API LOG] Buscando chat específico: ${targetChatId}...`);
            const chat = await client.getChatById(targetChatId);
            
            if (!chat) {
                // Se o chat não for encontrado, tratamos o erro aqui
                return res.status(404).send(`Chat com ID ${targetChatId} não encontrado.`);
            }
            chatsToProcess.push(chat);
            chatTitle = chat.name || chat.formattedTitle || targetChatId.split('@')[0];
            fileNameBase = `${date}-${targetChatId.split('@')[0]}`; 
        } else {
            // Todos os chats (comportamento original)
            console.log('[API LOG] Buscando todos os chats...');
            chatsToProcess = await client.getChats();
        }

        const outFile = `mensagens-${fileNameBase}.txt`;

        console.log(`[API LOG] Encontrados ${chatsToProcess.length} chat(s) para processar. Arquivo: ${outFile}`);

        // remove arquivo antigo
        if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

        // Cabeçalho do Arquivo TXT
        const header = `--- EXPORTAÇÃO DE MENSAGENS WHATSAPP ---
Data da Exportação: ${dayjs().tz('America/Sao_Paulo').format('YYYY-MM-DD HH:mm:ss')}
Período Buscado: ${date} (Dia Completo)
Chat(s) Processado(s): ${targetChatId ? chatTitle : 'Todos os Chats'}
------------------------------------------------------\n\n`;
        fs.appendFileSync(outFile, header);

        for (const chat of chatsToProcess) {
            // Pequeno atraso para evitar ser bloqueado
            await new Promise(resolve => setTimeout(resolve, 500)); 
            
            const currentChatTitle = chat.name || chat.formattedTitle || chat.id._serialized;
            console.log(`[API LOG] Processando: ${currentChatTitle}`);
            
            // Pega as últimas 1000 mensagens
            let messages = await chat.fetchMessages({ limit: 1000 });
            
            // Filtra por data exata (timestamp em segundos)
            messages = messages.filter(m => m.timestamp >= start && m.timestamp <= end);

            if (messages.length === 0) {
                continue;
            }

            // Separador para o novo chat
            const chatSeparator = `\n\n=== CHAT: ${currentChatTitle} (${chat.id._serialized}) - ${messages.length} MENSAGENS ===\n\n`;
            fs.appendFileSync(outFile, chatSeparator);

            for (const m of messages) {
                // Formata o timestamp (segundos) para data/hora local
                const time = dayjs.unix(m.timestamp).tz('America/Sao_Paulo').format('HH:mm:ss');
                // Identifica o autor
                const author = m.author || m.fromMe ? 'EU' : m.from.split('@')[0];
                const body = m.hasMedia ? '[MÍDIA/ARQUIVO ANEXADO]' : (m.body || '[Mensagem sem corpo]');
                
                // Formato de texto simples
                const entry = `[${time}] [De: ${author}] - ${body}`;
                fs.appendFileSync(outFile, entry + '\n');
            }

            console.log(`[API LOG] -> Salvo ${messages.length} mensagens de ${currentChatTitle}`);
        }

        console.log(`[API LOG] Concluído. Enviando arquivo para download: ${outFile}`);

        // Envia o arquivo para download e encerra a resposta HTTP
        res.download(outFile, (err) => {
            if (err) {
                console.error('[API ERRO] Erro ao enviar arquivo para download:', err);
                // Tenta enviar a mensagem de erro se o download falhar
                // NOTA: Não podemos chamar res.status(500) aqui, pois os headers já foram enviados por res.download.
                // Apenas logamos o erro no console.
            } else {
                console.log('[API LOG] Download do arquivo TXT iniciado pelo cliente.');
            }
        });

    } catch (err) {
        // Bloco CATCH ÚNICO: Captura erros da busca de chat, fetch de mensagens, ou escrita de arquivo.
        console.error('[API ERRO] Erro na exportação:', err);
        // Se a resposta ainda não foi enviada, enviamos o erro.
        if (!res.headersSent) {
            res.status(500).send('Erro interno no servidor durante a exportação: ' + String(err));
        }
    }
});

// Adiciona rota raiz para servir a interface diretamente
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/export_interface.html');
});

app.listen(PORT, () => {
  console.log(`API rodando em http://localhost:${PORT}`);
  console.log(`Interface Simplificada: http://localhost:${PORT}`);
});
