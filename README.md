# Secret Call V1.4.7 — Screen Share Audio

Baseada diretamente na V1.4.6 que estabilizou o compartilhamento de tela.

## O que mudou
- O compartilhamento continua em PeerConnection separado da call.
- Agora envia a track de vídeo da tela e também a track de áudio disponibilizada pelo navegador.
- Microfone e câmera da call principal continuam isolados.
- O receptor monta um MediaStream da transmissão com vídeo + áudio.
- O status informa se o navegador realmente entregou áudio da transmissão.
- TURN e ICE do canal separado continuam ativos.
- package-lock.json do client e server foram preservados.

## Importante sobre áudio da tela
O navegador só fornece áudio quando o tipo de captura escolhido oferece isso.

Em navegadores Chromium (Chrome/Edge/Opera):
- ao compartilhar uma aba, marque "Compartilhar áudio da guia";
- ao compartilhar a tela inteira, use a opção "Compartilhar também o áudio do sistema" quando ela aparecer;
- algumas combinações de navegador/SO não fornecem áudio para certas janelas específicas.

Se o status mostrar:
`sem áudio da transmissão`
o navegador não forneceu nenhuma audio track, mesmo que o app tenha solicitado.
