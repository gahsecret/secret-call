# Secret Call V1.4.4 — Bidirectional Media Fix

Base: V1.4.1 (áudio que funcionou no teste).

Correções:
- A negociação foi invertida: quem JÁ ESTÁ na sala cria a oferta para quem acabou de entrar.
- O novo participante responde à oferta já com sua mídia preparada.
- Áudio e vídeo têm canais sendrecv reservados desde a primeira negociação.
- Ligar câmera/microfone depois usa replaceTrack.
- Compartilhamento usa o mesmo canal de vídeo e não renegocia a call.
- TURN e fila de ICE continuam ativos.

Teste:
1. Criador e convidado devem se ouvir nos dois sentidos.
2. Criador compartilha -> convidado vê.
3. Convidado compartilha -> criador vê.
