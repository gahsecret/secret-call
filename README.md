# SECRET CALL V1.3.1 — PRE-CALL

Esta versão foi preparada para rodar em um servidor público 24h.

## O que continua funcionando
- Criar sala sem cadastro
- Entrada somente por código
- Código de 6 caracteres
- Código expira/troca a cada 5 minutos
- A call continua a mesma quando o código troca
- Até 10 pessoas por sala
- Até 3 compartilhamentos simultâneos
- 720p / 1080p
- Janela separada para mover ao segundo monitor
- Microfone e câmera
- Reconexão automática do Socket.IO

## Como testar no seu PC

Use `START.bat`.

Site:
http://localhost:5173

Servidor:
http://localhost:3001

## Como testar como se fosse produção no seu PC

Execute:

`START_PRODUCAO_LOCAL.bat`

Depois abra:

http://localhost:3001

Neste modo o próprio Node serve o site e o WebSocket no mesmo endereço.

## Como colocar na internet

A V1.3 inclui `Dockerfile`, então pode ser publicada em qualquer host que aceite Docker/Node.

Fluxo esperado:

1. Envie esta pasta para um repositório Git.
2. Crie um Web Service no seu provedor.
3. Use o Dockerfile do projeto.
4. O provedor fornecerá um endereço HTTPS.
5. Seus amigos acessam esse endereço.
6. Uma pessoa clica em "Criar nova sala".
7. Ela envia o código de 6 caracteres.
8. Os amigos acessam o mesmo site e entram com o código.

Não é necessário enviar link de sala.

## HTTPS

Câmera, microfone e compartilhamento de tela exigem contexto seguro em navegadores modernos.
`localhost` é aceito para desenvolvimento; na internet use HTTPS.

## TURN

A V1.3 já aceita configuração TURN através do arquivo `client/.env`.

Sem TURN, WebRTC pode funcionar em muitas redes, mas algumas combinações de operadoras, CGNAT, Wi‑Fi corporativo e firewall podem impedir conexão.

Variáveis:

VITE_TURN_URL
VITE_TURN_USERNAME
VITE_TURN_CREDENTIAL

## Observação de arquitetura

A transmissão ainda é P2P mesh.

O limite visual/servidor é 10 pessoas e 3 compartilhamentos, mas para uma sala real com muitas pessoas usando 1080p/60 FPS, a próxima arquitetura recomendada é SFU (ex.: LiveKit/mediasoup) + TURN. Isso reduz muito o upload exigido de cada participante.


## V1.3.1
- Entrada não é mais bloqueada por falha da câmera.
- Pré-call antes de criar/entrar.
- Câmera e microfone independentes.
- Pode entrar sem câmera, sem microfone ou somente como ouvinte.
- Botão para tentar ativar câmera/microfone novamente.
