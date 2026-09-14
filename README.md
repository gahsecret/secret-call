# Secret Call V1.6.0 — WebRTC Stable Multi-Screen

Base: V1.5.0 estável.

Correções principais:
- negociação WebRTC com tratamento de colisão (perfect negotiation) para áudio/câmera;
- tela com conexões independentes de saída e entrada por participante;
- dois participantes podem compartilhar tela simultaneamente;
- áudio da transmissão continua separado da chamada;
- ICE de tela separado por direção;
- parar sua tela não encerra a tela recebida do amigo.

Não usa SFU externo nesta versão. Mantém P2P + TURN.
