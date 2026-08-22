# Secret Call V1.4.6 — Separate Screen Channel

Esta versão foi criada diretamente a partir do ZIP exato enviado pelo usuário,
que estava online com áudio funcionando.

## Mudança principal
O compartilhamento de tela agora usa um RTCPeerConnection separado por participante.

Isso significa:
- áudio/microfone continuam exatamente no PeerConnection principal;
- câmera continua no PeerConnection principal;
- compartilhar/parar tela NÃO renegocia áudio;
- tela possui Offer/Answer/ICE próprios;
- TURN configurado no Render é usado também pela tela;
- até 3 compartilhamentos continuam controlados pelo servidor;
- a tela aparece como tile separado `NOME • TELA`.

Os package-lock.json existentes no ZIP original foram preservados.
