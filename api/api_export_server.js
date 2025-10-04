// api_export_terminal_qr.js
// npm i whatsapp-web.js qrcode-terminal dayjs express

const express = require('express');
const fs = require('fs');
const dayjs = require('dayjs');
const qrcode = require('qrcode-terminal');
const { Client } = require('whatsapp-web.js');

// Adiciona os plugins do dayjs para formatação e manipulação de fuso horário
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
    slowMo: 250, // AUMENTADO PARA MAIOR ESTABILIDADE EM BUSCAS ANTIGAS
    
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
  let targetChatId = req.query.chatId; // Usamos LET para poder limpar o valor
  
    // NOVOS PARAMETROS DE HORA (opcional)
  const startTime = req.query.startTime || '00:00'; 
  const endTime = req.query.endTime || '23:59'; 
  
  if (!date) return res.status(400).send('Passe ?date=YYYY-MM-DD');

    // ** SANITIZAÇÃO E FORMATAÇÃO DO CHAT ID (PADRONIZAÇÃO) **
    if (targetChatId) {
        // 1. Limpeza: Remove todos os caracteres que NÃO SÃO números, '@' ou '.'
        targetChatId = targetChatId.replace(/[^0-9@.]/g, ''); 

        // 2. Padronização: Se o ID limpo não contiver '@', assume que é um contato e adiciona '@c.us'.
        if (!targetChatId.includes('@') && targetChatId.length > 0) {
            targetChatId = `${targetChatId}@c.us`;
            console.log(`[API LOG] Chat ID padronizado para: ${targetChatId}`);
        }
    }
    // **********************************************************

    // Inicio do bloco TRY principal para toda a lógica de exportação
    try { 
        // Combina a data com a hora para criar a string de data/hora completa
        const startDateTimeString = `${date} ${startTime}`;
        const endDateTimeString = `${date} ${endTime}`;
        
        // Define o intervalo em Unix Timestamp (segundos)
        // Usamos o formato 'YYYY-MM-DD HH:mm' para garantir a correta interpretação.
        const start = dayjs(startDateTimeString, 'YYYY-MM-DD HH:mm').unix();
        const end = dayjs(endDateTimeString, 'YYYY-MM-DD HH:mm').unix();
        
        let chatsToProcess = [];
        let chatTitle = 'MultiplosChats'; 
        let fileNameBase = `${date}_${startTime.replace(':', '')}-${endTime.replace(':', '')}`; // Adiciona hora no nome do arquivo

        // Lógica de Filtragem de Chat
        if (targetChatId) {
            console.log(`[API LOG] Buscando chat específico: ${targetChatId}...`);
            let chat;
            try {
                // Tenta buscar o chat pelo ID fornecido
                // O tratamento de erro aqui intercepta o erro 'Evaluation failed: b'
                chat = await client.getChatById(targetChatId);
            } catch (e) {
                // TRATAMENTO DE ERRO APRIMORADO
                console.error('[API ERRO] Falha ao buscar Chat ID. Verifique o formato:', e);
                return res.status(400).send(`❌ ERRO: O Chat ID fornecido (${targetChatId}) é inválido ou não foi encontrado. Certifique-se de que o ID está correto (ex: 5511999999999@c.us) e o WhatsApp está conectado. Detalhe: ${e.message}`);
            }

            if (!chat) {
                return res.status(404).send(`Chat com ID ${targetChatId} não encontrado. Verifique se o ID está correto e se o chat existe na sua lista.`);
            }
            chatsToProcess.push(chat);
            chatTitle = chat.name || chat.formattedTitle || targetChatId.split('@')[0];
            fileNameBase = `${date}-${targetChatId.split('@')[0]}_${startTime.replace(':', '')}-${endTime.replace(':', '')}`; 
        } else {
            console.log('[API LOG] Buscando todos os chats...');
            chatsToProcess = await client.getChats();
        }

        const outFile = `mensagens-${fileNameBase}.txt`;

        console.log(`[API LOG] Encontrados ${chatsToProcess.length} chat(s) para processar. Arquivo: ${outFile}`);

        // remove arquivo antigo
        if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

        // Cabeçalho do Arquivo TXT (Atualizado para incluir o horário)
        const header = `--- EXPORTAÇÃO DE MENSAGENS WHATSAPP ---
Data da Exportação: ${dayjs().tz('America/Sao_Paulo').format('YYYY-MM-DD HH:mm:ss')}
Período Buscado: ${date} das ${startTime}h às ${endTime}h
Chat(s) Processado(s): ${targetChatId ? chatTitle : 'Todos os Chats'}
------------------------------------------------------\n\n`;
        fs.appendFileSync(outFile, header);

        for (const chat of chatsToProcess) {
            // Pequeno atraso para evitar ser bloqueado
            await new Promise(resolve => setTimeout(resolve, 500)); 
            
            const currentChatTitle = chat.name || chat.formattedTitle || chat.id._serialized;
            console.log(`[API LOG] Processando: ${currentChatTitle}`);
            
            // =========================================================================
            // LÓGICA DE BUSCA PAGINADA (para garantir que pegue mensagens antigas)
            // =========================================================================
            const BATCH_SIZE = 1000; // Lotes menores para maior estabilidade
            let allMessages = [];
            let oldestMessageTimestamp = Infinity;
            let targetDateCovered = false;

            console.log(`[API LOG] Iniciando busca paginada para cobrir o período.`);

            while (!targetDateCovered) {
                // Configura as opções de busca para buscar o lote antes da mensagem mais antiga já encontrada
                let options = { 
                    limit: BATCH_SIZE,
                    // Se oldestMessageTimestamp for Infinity (primeira rodada), 'before' é undefined e a API pega as mensagens mais recentes
                    before: oldestMessageTimestamp !== Infinity ? oldestMessageTimestamp : undefined
                };

                let newMessages;
                try {
                    newMessages = await chat.fetchMessages(options);
                } catch (e) {
                    console.error('[API ERRO] Falha na busca paginada para este chat. Interrompendo.', e.message);
                    break; // Interrompe o loop para evitar crash
                }

                if (newMessages.length === 0) {
                    console.log('[API LOG] Fim do histórico do chat alcançado.');
                    break; // Não há mais mensagens para buscar
                }

                // A última mensagem do lote é a mais antiga
                const oldestNewMessage = newMessages[newMessages.length - 1];
                
                // 1. Atualiza o timestamp da mensagem mais antiga para a próxima iteração
                oldestMessageTimestamp = oldestNewMessage.timestamp;

                // 2. Adiciona o novo lote à lista total
                allMessages.push(...newMessages);
                
                // 3. Verifica se a mensagem mais antiga do lote já é ANTERIOR ou igual ao início do dia (start).
                // Se o timestamp da mensagem mais antiga for MENOR que o início do dia, a busca pode parar.
                if (oldestNewMessage.timestamp <= start) {
                    targetDateCovered = true;
                    console.log(`[API LOG] Data inicial (${dayjs.unix(start).format('DD/MM HH:mm')}) alcançada. Parando a busca.`);
                } else {
                    console.log(`[API LOG] Última mensagem encontrada: ${dayjs.unix(oldestNewMessage.timestamp).format('DD/MM HH:mm')}. Continuando...`);
                }

                // Pequeno atraso para evitar ser bloqueado (só atrasa se estivermos indo buscar mais)
                if (!targetDateCovered) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            let messages = allMessages; 
            
            // Aplicamos o filtro final para isolar o período solicitado (data e hora)
            messages = messages.filter(m => m.timestamp >= start && m.timestamp <= end);
            // =========================================================================
            
            if (messages.length === 0) {
                // Se não houver mensagens no período, continua para o próximo chat
                continue; 
            }

            // Garante que as mensagens estão na ordem correta
            messages.sort((a, b) => a.timestamp - b.timestamp);

            // Separador para o novo chat
            const chatSeparator = `\n\n=== CHAT: ${currentChatTitle} (${chat.id._serialized}) - ${messages.length} MENSAGENS ===\n\n`;
            fs.appendFileSync(outFile, chatSeparator);

            for (const m of messages) {
                // Formata o timestamp (segundos) para data/hora local
                const time = dayjs.unix(m.timestamp).tz('America/Sao_Paulo').format('HH:mm:ss');
                
                // IDENTIFICA O ID/NÚMERO COMPLETO (ex: 5511999999999@c.us)
                const senderId = m.fromMe ? 'EU' : m.from; 
                
                const body = m.hasMedia ? '[MÍDIA/ARQUIVO ANEXADO]' : (m.body || '[Mensagem sem corpo]');
                
                // Formato de texto simples: [Hora] [ID_Completo] - Mensagem
                const entry = `[${time}] [${senderId}] - ${body}`;
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
        // Bloco CATCH ÚNICO: Captura erros gerais de exportação
        console.error('[API ERRO] Erro geral na exportação:', err);
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
