# Secret Call V1.4.5 — Remote Track Fix

Baseada diretamente na V1.4.1 que apresentou o melhor resultado de áudio.

Correção principal:
- O recebimento remoto não usa mais apenas `event.streams[0]`.
- Cada `event.track` recebido é colocado manualmente em um MediaStream por participante.
- Isso evita perder áudio/vídeo quando `RTCTrackEvent.streams` chega vazio.
- O vídeo remoto chama `play()` explicitamente.
- A negociação da V1.4.1 foi preservada.
- TURN e fila ICE foram preservados.

Diagnóstico:
Dentro da call clique em `🔧 Diagnóstico`.
Para cada pessoa ele mostra conexão, ICE, senders, receivers e tracks realmente recebidas.
