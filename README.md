🤖 WhatsApp Message Exporter (Node.js + whatsapp-web.js)
Este projeto é uma API Node.js simples que utiliza a biblioteca whatsapp-web.js para conectar-se ao WhatsApp via QR Code e exportar históricos de conversas (chats) para um arquivo de texto (.txt), aplicando filtros avançados de Data e Horário.

A principal funcionalidade é a Busca Paginada Robusta, que contorna a limitação de busca da API do WhatsApp Web, garantindo que mesmo mensagens muito antigas sejam alcançadas e exportadas.

✨ Funcionalidades Principais
Autenticação Simples: Login via QR Code no terminal.

Interface Web (Local): Formulário HTML simples para configurar a exportação.

Filtro por Data e Hora: Exporta apenas mensagens que caem no período especificado.

Busca Paginada (Anti-Limite): Realiza múltiplas buscas ("scrolling") para garantir que o histórico completo, incluindo mensagens antigas, seja coberto antes de aplicar o filtro de data.

Sanitização de IDs: Limpa e padroniza automaticamente o ID de contato (5511999999999 é formatado para 5511999999999@c.us).

Tratamento de Erro: Bloco de tratamento específico para falhas na busca de Chat ID (Evaluation failed: b).

🛠️ Pré-requisitos
Antes de começar, você precisa ter o Node.js e o npm instalados em sua máquina.

Node.js (LTS): Baixe e instale em nodejs.org.

Dependências da API:

npm i whatsapp-web.js qrcode-terminal dayjs express

⚙️ Instalação e Execução
1. Salvar os Arquivos
Crie uma pasta para o projeto (ex: whatsapp-exporter).

Salve o código do servidor no arquivo api_export_terminal_qr.js.

Salve o código da interface no arquivo export_interface.html.

2. Rodar o Servidor
Abra o terminal na pasta do projeto e execute:

node api_export_terminal_qr.js

3. Conexão (QR Code)
Ao iniciar, o servidor exibirá um QR Code no terminal.

Use o seu celular: abra o WhatsApp, vá em Configurações (ou Três Pontos no Android) > Dispositivos Conectados > Conectar um dispositivo.

Escaneie o QR Code. O servidor emitirá uma mensagem ✅ WhatsApp conectado (sessão pronta). quando estiver pronto.

4. Acessar a Interface Web
Abra seu navegador e acesse:

http://localhost:3000

📝 Uso e Parâmetros
Na interface web, você deve preencher os seguintes campos:

Data (AAAA-MM-DD): O dia que deseja exportar (obrigatório).

ID do Chat (opcional): O número de telefone (apenas números) ou ID de grupo. Se você inserir apenas o número, o sistema adicionará o @c.us automaticamente. Se for um chat em grupo, insira o ID completo (ex: 123456789-123456@g.us).

Hora Inicial/Final (HH:MM): O intervalo de tempo dentro da data selecionada.

⚠️ Log da Busca Paginada
Ao clicar em INICIAR EXPORTAÇÃO, acompanhe o terminal do Node.js. Ele mostrará o log da busca paginada, indicando quantas mensagens foram buscadas e quando o período alvo (start) foi alcançado.

[API LOG] Iniciando busca paginada para cobrir o período.
[API LOG] Última mensagem encontrada: 20/08 15:00. Continuando... (Se for antes da data inicial, ele para.)

🌐 Endpoints da API
A API Express expõe os seguintes endpoints:

Método

Endpoint

Descrição

GET

/

Serve a interface HTML (export_interface.html).

GET

/status

Verifica se o cliente WhatsApp está conectado ({ ready: true/false }).

GET

/export

Inicia o processo de exportação.

Exemplo de Uso do Endpoint /export
http://localhost:3000/export?date=2024-10-03&chatId=5511987654321&startTime=09:00&endTime=18:00

Parâmetros:

date: YYYY-MM-DD (Obrigatório)

chatId: ID do chat (Opcional, aceita números não formatados).

startTime: HH:MM (Opcional, padrão '00:00').

endTime: HH:MM (Opcional, padrão '23:59')