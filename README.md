# SECRET CALL V1.4 — TURN + WebRTC FIX

## Novidades
- TURN Metered configurado por variáveis do Render
- STUN + TURN UDP/TCP/TLS
- endpoint `/ice-config`
- credenciais não ficam no GitHub
- fila de ICE candidates para evitar perda antes do remoteDescription
- status TURN ativo/inativo na call
- status de conexão dos peers
- mantém pré-call da V1.3.1
- 10 pessoas, 3 compartilhamentos, código rotativo de 5 minutos

## Variáveis obrigatórias no Render
Crie em Environment:

TURN_USERNAME=<username da credencial Metered>
TURN_PASSWORD=<password da credencial Metered>

Depois salve e faça deploy.

## Teste
Abra https://secret-call.onrender.com em duas redes diferentes.
Na call deve aparecer `TURN ativo`.

Para um teste realmente forte do relay, use PC no Wi-Fi e celular em 4G/5G.
