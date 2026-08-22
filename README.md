# Secret Call V1.4.1 — Correção de áudio bidirecional

Esta versão corrige um problema em que o participante que CRIAVA a sala era ouvido,
mas o participante que ENTRAVA pelo código não enviava áudio/vídeo de volta.

## Correções
- A entrada espera a preparação real de câmera/microfone antes do JOIN.
- O participante que entra só cria a oferta WebRTC depois de anexar suas tracks.
- Quem já está na sala anexa suas tracks antes de criar a resposta.
- Transceivers com mídia são mantidos em `sendrecv`.
- TURN Metered continua funcionando via `TURN_USERNAME` e `TURN_PASSWORD`.
- Fila de ICE da V1.4 foi mantida.

## Atualização
Copie os arquivos desta versão para o repositório, faça Commit + Push e espere o Render ficar Live.
As variáveis TURN já configuradas no Render não precisam ser recriadas.
