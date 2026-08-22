# Secret Call V1.4.3 — Stable Screen Share

Base exata: V1.4.1 enviada pelo usuário, onde o áudio bidirecional estava funcionando.

## O que foi alterado
- Não há renegociação ao iniciar/parar compartilhamento.
- Um canal de vídeo é reservado já na negociação inicial, inclusive para quem entra sem câmera.
- Compartilhamento apenas usa `replaceTrack()` nesse canal.
- Ao parar, volta para câmera ou para `null`.
- Áudio, TURN e fila ICE permanecem com o comportamento da V1.4.1.

A V1.4.2 foi descartada como base porque a renegociação de tela fazia o áudio regredir.
