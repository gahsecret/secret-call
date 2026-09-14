# Secret Call V1.6.3 — WebRTC Stable Multi-Screen

Base: V1.5.0 estável.

Correções principais:
- negociação WebRTC com tratamento de colisão (perfect negotiation) para áudio/câmera;
- tela com conexões independentes de saída e entrada por participante;
- dois participantes podem compartilhar tela simultaneamente;
- áudio da transmissão continua separado da chamada;
- ICE de tela separado por direção;
- parar sua tela não encerra a tela recebida do amigo.

Não usa SFU externo nesta versão. Mantém P2P + TURN.


## V1.6.3
- Corrige a janela separada de vídeo/tela para anexar o MediaStream e chamar play() explicitamente, evitando popup preto por autoplay.
- Adiciona botão fixo de Tela cheia no topo da call.
- Adiciona botão de Tela cheia em cada vídeo.
- A janela separada também possui Tela cheia opcional.
