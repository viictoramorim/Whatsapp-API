// api_export_terminal_qr.js
// npm i whatsapp-web.js qrcode-terminal dayjs express

const express = require('express');
const fs = require('fs');
const dayjs = require('dayjs');
const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js'); // Removido o import do LocalAuth

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
  // NÃO HÁ ESTRATÉGIA DE AUTENTICAÇÃO (LocalAuth) AQUI.
  // Isso garante que o QR Code seja solicitado a cada inicialização.
  puppeteer: {
    // BROWSER VISÍVEL
    headless: false,
    slowMo: 100, 
    
    // ATENÇÃO: Se quiser usar o seu Google Chrome normal (não o de teste),
    // DESCOMENTE a linha abaixo e COLOQUE O CAMINHO CORRETO do executável.
    // Exemplo Windows: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    // executablePath: 'INSIRA AQUI O CAMINHO COMPLETO DO SEU CHROME', 

    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-gpu',
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
  console.error('Falha de autenticação. Um novo QR Code deve ser gerado na próxima inicialização.', msg);
  isReady = false;
});

client.on('disconnected', (reason) => {
  console.log('Desconectado. A sessão não será salva e exigirá um novo QR na próxima vez.', reason);
  isReady = false;
});

// Tratamento de inicialização assíncrona
async function initializeClient() {
    try {
        console.log('Iniciando cliente WhatsApp (Browser Visível)...');
        await client.initialize();
    } catch (error) {
        console.error('❌ Erro na inicialização do cliente:', error.message);
    }
}

initializeClient();


// Middleware para servir arquivos estáticos (como export_interface.html e os arquivos TXT)
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


// exporta mensagens por data e por contato (gera o TXT, mas não força o download)
app.get('/export', async (req, res) => {
  if (!isReady) return res.status(400).send('Cliente não está pronto. Escaneie o QR no terminal.');
  
  const date = req.query.date;
  const targetChatId = req.query.chatId;
  
  if (!date) return res.status(400).send('Passe ?date=YYYY-MM-DD');

    // Inicio do bloco TRY principal para toda a lógica de exportação
    try { 
        // Define o início (00:00:00) e o fim (23:59:59) do dia para a filtragem
        const start = dayjs(date).startOf('day').unix();
        const end = dayjs(date).endOf('day').unix();
        
        let chatsToProcess = [];
        let chatTitle = 'MultiplosChats'; 
        let fileNameBase = `${date}`;

        // Lógica de Filtragem de Chat
        if (targetChatId) {
            console.log(`[API LOG] Buscando chat específico: ${targetChatId}...`);
            const chat = await client.getChatById(targetChatId);
            
            if (!chat) {
                return res.status(404).send(`Chat com ID ${targetChatId} não encontrado.`);
            }
            chatsToProcess.push(chat);
            chatTitle = chat.name || chat.formattedTitle || targetChatId.split('@')[0];
            fileNameBase = `${date}-${targetChatId.split('@')[0]}`; 
        } else {
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
            
            // NOVO: Mecanismo de paginação para buscar todas as mensagens necessárias para cobrir o dia.
            let allMessages = [];
            let lastMessageId = null;
            // Reduzido para 1000 para maior estabilidade em cada passo da paginação profunda
            const BATCH_SIZE = 1000; 
            let foundAllDay = false;

            console.log(`[API LOG] -> Iniciando busca paginada para ${currentChatTitle}...`);

            // Continuar buscando em batches (lotes) até que a primeira mensagem buscada seja anterior ao início do dia (start)
            while (!foundAllDay) {
                const options = {
                    limit: BATCH_SIZE,
                    before: lastMessageId // ID da mensagem mais antiga do lote anterior para rolar o histórico
                };

                // Pede o próximo lote de mensagens
                const batch = await chat.fetchMessages(options);

                if (batch.length === 0) {
                    // Não há mais mensagens para buscar no histórico (chegou ao fim do chat)
                    console.log(`[API LOG] -> Histórico finalizado após ${allMessages.length} mensagens buscadas.`);
                    break; 
                }

                // Adiciona o novo lote de mensagens à lista total
                allMessages.push(...batch);

                // Pega a mensagem mais antiga (última no array 'batch')
                const oldestMessage = batch[batch.length - 1];
                lastMessageId = oldestMessage.id;
                
                // Se a mensagem mais antiga do lote for anterior (ou igual) ao início do dia,
                // encontramos tudo o que precisávamos para cobrir o dia e podemos parar.
                if (oldestMessage.timestamp <= start) {
                    foundAllDay = true;
                    console.log(`[API LOG] -> Data inicial (${dayjs.unix(start).format('DD/MM/YYYY')}) atingida. Total: ${allMessages.length} mensagens buscadas.`);
                } else {
                    console.log(`[API LOG] -> Buscando lote anterior. Total: ${allMessages.length} mensagens. Última mensagem em: ${dayjs.unix(oldestMessage.timestamp).format('DD/MM/YYYY HH:mm:ss')}`);
                    // Adicionar um pequeno delay para evitar bloqueio
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            // Depois de buscar o suficiente, aplicamos o filtro final para isolar APENAS o dia solicitado
            let messages = allMessages.filter(m => m.timestamp >= start && m.timestamp <= end);
            
            if (messages.length === 0) {
                // Se não houver mensagens no dia, continua para o próximo chat
                continue; 
            }

            // Garante que as mensagens estão na ordem correta (por padrão, vêm do mais novo para o mais antigo, vamos ordenar)
            messages.sort((a, b) => a.timestamp - b.timestamp);
            // FIM DO NOVO MECANISMO DE BUSCA

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

        console.log(`[API LOG] Concluído. Arquivo TXT gerado: ${outFile}`);

        // Retorna o nome do arquivo para o cliente (interface)
        res.json({
            success: true,
            filename: outFile,
            message: `Arquivo ${outFile} gerado com sucesso no servidor.`
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
