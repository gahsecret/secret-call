# Secret Call V1.5.1 — Simultaneous Screen Share Fix

Base: V1.5.0 com áudio, TURN e layout funcionando.

Correção:
- tela enviada e tela recebida agora usam PeerConnections separados;
- A pode compartilhar para B enquanto B compartilha para A;
- parar sua própria tela não fecha a tela que você está recebendo;
- ICE da transmissão também é separado por direção;
- áudio/câmera/call principal não foram alterados.

Mantidos:
- até 3 compartilhamentos
- áudio da transmissão
- TURN
- chat
- gravação
- layout neon/gamer
