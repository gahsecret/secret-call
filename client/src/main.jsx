import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const SIGNALING =
  import.meta.env.VITE_SIGNALING_URL ||
  (window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin);

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...(import.meta.env.VITE_TURN_URL
    ? [{
        urls: import.meta.env.VITE_TURN_URL,
        username: import.meta.env.VITE_TURN_USERNAME || '',
        credential: import.meta.env.VITE_TURN_CREDENTIAL || ''
      }]
    : [])
];

function App() {
  const [name, setName] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [codeExpiresAt, setCodeExpiresAt] = useState(0);
  const [countdown, setCountdown] = useState('05:00');
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [quality, setQuality] = useState('1080');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [sharingCount, setSharingCount] = useState(0);
  const [status, setStatus] = useState('Pronto');
  const [remoteStreams, setRemoteStreams] = useState({});

  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef(new Map());

  useEffect(() => () => cleanup(), []);

  useEffect(() => {
    if (!codeExpiresAt) return;
    const tick = () => {
      const sec = Math.max(0, Math.ceil((codeExpiresAt - Date.now()) / 1000));
      setCountdown(`${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [codeExpiresAt]);

  async function ensureLocalMedia() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  }

  function createPeer(targetId) {
    if (peersRef.current.has(targetId)) return peersRef.current.get(targetId);
    const pc = new RTCPeerConnection({ iceServers });
    localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    pc.onicecandidate = e => {
      if (e.candidate) socketRef.current?.emit('webrtc-ice-candidate', { target: targetId, candidate: e.candidate });
    };
    pc.ontrack = e => {
      setRemoteStreams(prev => ({ ...prev, [targetId]: e.streams[0] }));
    };
    peersRef.current.set(targetId, pc);
    return pc;
  }

  async function makeOffer(targetId) {
    const pc = createPeer(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current.emit('webrtc-offer', { target: targetId, offer });
  }

  async function connectSocket() {
    if (socketRef.current?.connected) return socketRef.current;
    const socket = io(SIGNALING, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000
    });
    socketRef.current = socket;

    socket.on('connect', () => setStatus('Servidor conectado'));
    socket.on('disconnect', () => setStatus('Reconectando ao servidor...'));
    socket.on('connect_error', () => setStatus('Servidor indisponível'));

    socket.on('room-users', async users => {
      for (const u of users) await makeOffer(u.socketId);
    });
    socket.on('participants', list => {
      setParticipants(list);
      setSharingCount(list.filter(p => p.sharing).length);
    });
    socket.on('room-code-updated', ({ code, expiresAt }) => {
      setRoomCode(code);
      setCodeExpiresAt(expiresAt);
      setStatus('Novo código da sala gerado');
    });
    socket.on('sharing-count', ({ count }) => setSharingCount(count));
    socket.on('webrtc-offer', async ({ from, offer }) => {
      const pc = createPeer(from);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', { target: from, answer });
    });
    socket.on('webrtc-answer', async ({ from, answer }) => {
      const pc = peersRef.current.get(from);
      if (pc && !pc.currentRemoteDescription) await pc.setRemoteDescription(answer);
    });
    socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
      const pc = createPeer(from);
      try { await pc.addIceCandidate(candidate); } catch (e) { console.warn(e); }
    });
    socket.on('user-left', ({ socketId }) => {
      peersRef.current.get(socketId)?.close();
      peersRef.current.delete(socketId);
      setRemoteStreams(prev => { const n = { ...prev }; delete n[socketId]; return n; });
    });
    return socket;
  }

  async function prepare() {
    if (!name.trim()) throw new Error('Digite seu nome.');
    setStatus('Solicitando câmera e microfone...');
    await ensureLocalMedia();
    return await connectSocket();
  }

  async function createRoom() {
    try {
      const socket = await prepare();
      socket.emit('create-room', { name: name.trim() }, res => {
        if (!res?.ok) return alert(res?.error || 'Não foi possível criar a sala.');
        setRoomCode(res.code); setCodeExpiresAt(res.expiresAt); setJoined(true); setStatus('Sala criada');
      });
    } catch (e) { alert(e.message || 'Erro ao acessar câmera/microfone.'); }
  }

  async function joinRoom() {
    if (!codeInput.trim()) return alert('Digite o código da sala.');
    try {
      const socket = await prepare();
      socket.emit('join-room', { code: codeInput.trim().toUpperCase(), name: name.trim() }, res => {
        if (!res?.ok) return alert(res?.error || 'Não foi possível entrar.');
        setRoomCode(res.code); setCodeExpiresAt(res.expiresAt); setJoined(true); setStatus('Conectado');
      });
    } catch (e) { alert(e.message || 'Erro ao acessar câmera/microfone.'); }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(roomCode);
    setStatus('Código copiado');
  }

  function toggleMic() {
    localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = !micOn);
    setMicOn(v => !v);
  }
  function toggleCam() {
    localStreamRef.current?.getVideoTracks().forEach(t => t.enabled = !camOn);
    setCamOn(v => !v);
  }

  async function shareScreen() {
    if (sharing) return stopScreenShare();
    socketRef.current.emit('request-screen-share', {}, async res => {
      if (!res?.ok) return alert(res?.error || 'Não foi possível compartilhar.');
      try {
        const is1080 = quality === '1080';
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { width: { ideal: is1080 ? 1920 : 1280 }, height: { ideal: is1080 ? 1080 : 720 }, frameRate: { ideal: 60, max: 60 } },
          audio: true
        });
        screenStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        for (const pc of peersRef.current.values()) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(track);
        }
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        track.onended = stopScreenShare;
        setSharing(true); setStatus(`Compartilhando ${quality}p`);
      } catch (e) {
        socketRef.current.emit('stop-screen-share');
      }
    });
  }

  async function stopScreenShare() {
    const camTrack = localStreamRef.current?.getVideoTracks()[0];
    if (camTrack) {
      for (const pc of peersRef.current.values()) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(camTrack);
      }
    }
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    socketRef.current?.emit('stop-screen-share');
    setSharing(false); setStatus('Compartilhamento encerrado');
  }

  function popout(stream, label) {
    if (!stream) return;
    const w = window.open('', '_blank', 'width=1100,height=700');
    if (!w) return alert('Permita pop-ups para abrir o vídeo em outra janela.');
    w.document.write(`<!doctype html><html><head><title>${label}</title><style>html,body{margin:0;width:100%;height:100%;background:#02060a;color:white;font-family:Arial;overflow:hidden}video{width:100%;height:100%;object-fit:contain}.tag{position:fixed;left:14px;bottom:14px;background:#07111bcc;padding:8px 12px;border-radius:9px}</style></head><body><video id="v" autoplay playsinline></video><div class="tag">${label}</div></body></html>`);
    w.document.close();
    const v = w.document.getElementById('v');
    v.srcObject = stream;
  }

  function cleanup() {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peersRef.current.forEach(pc => pc.close());
    peersRef.current.clear();
    socketRef.current?.disconnect();
  }

  function leave() {
    socketRef.current?.emit('leave-room');
    cleanup();
    setJoined(false); setParticipants([]); setRemoteStreams({}); setRoomCode(''); setCodeInput('');
  }

  if (!joined) return (
    <main className="landing">
      <div className="brand brandCenter">
        <div className="secretLogo"><span>SECRET</span><small>CALL</small></div>
        <p>Call privada • até 10 pessoas • código temporário</p>
      </div>
      <div className="joinCard">
        <label>Seu nome</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Gah Secret" />
        <div className="divider"><span>CRIAR</span></div>
        <button className="primary" onClick={createRoom}>Criar nova sala</button>
        <div className="divider"><span>OU ENTRAR</span></div>
        <label>Código da sala</label>
        <input value={codeInput} onChange={e => setCodeInput(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" />
        <button className="secondary" onClick={joinRoom}>Entrar com código</button>
      </div>
      <div className="features"><span>👥 10 pessoas</span><span>🖥 até 3 compartilhando</span><span>⏱ código troca em 5 min</span><span>🪟 janela para 2º monitor</span></div>
    </main>
  );

  const localStream = sharing ? screenStreamRef.current : localStreamRef.current;
  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="sideBrand"><b>SECRET</b><small>CALL</small></div>
        <div className="roomInfo">
          <small>CÓDIGO ATUAL</small><strong>{roomCode}</strong>
          <div className="expire">expira em {countdown}</div>
          <button onClick={copyCode}>Copiar código</button>
          <p>Quando trocar, todos continuam na mesma call.</p>
        </div>
        <div className="participants">
          <small>PARTICIPANTES ({participants.length}/10)</small>
          {participants.map(p => <div className="participant" key={p.socketId}><span className="dot"></span><span>{p.name}</span>{p.sharing && <em>🖥</em>}</div>)}
        </div>
      </aside>
      <section className="stage">
        <header>
          <div><h2>SECRET CALL</h2><p>{status}</p></div>
          <div className="topStats"><span>🖥 {sharingCount}/3 compartilhando</span><div className="quality"><span>Qualidade</span><select value={quality} onChange={e => setQuality(e.target.value)}><option value="720">720p</option><option value="1080">1080p</option></select></div></div>
        </header>
        <div className="videoGrid">
          <VideoTile streamRef={localVideoRef} label={`${name} (você)${sharing ? ' • TELA' : ''}`} muted onPop={() => popout(localStream, `${name} • ${sharing ? 'Tela' : 'Câmera'}`)} />
          {Object.entries(remoteStreams).map(([id, stream]) => {
            const p = participants.find(x => x.socketId === id);
            const label = `${p?.name || 'Convidado'}${p?.sharing ? ' • TELA' : ''}`;
            return <RemoteVideo key={id} stream={stream} label={label} onPop={() => popout(stream, label)} />;
          })}
          {Object.keys(remoteStreams).length === 0 && <div className="emptyTile"><div className="emptyIcon">#</div><h3>{roomCode}</h3><p>Envie apenas este código para seus amigos.</p><button onClick={copyCode}>Copiar código</button></div>}
        </div>
        <footer className="controls">
          <button className={micOn ? '' : 'off'} onClick={toggleMic}>{micOn ? '🎤' : '🔇'} <span>Microfone</span></button>
          <button className={camOn ? '' : 'off'} onClick={toggleCam}>{camOn ? '📹' : '🚫'} <span>Câmera</span></button>
          <button className={sharing ? 'active' : ''} onClick={shareScreen}>🖥 <span>{sharing ? 'Parar tela' : 'Compartilhar'}</span></button>
          <button className="windowBtn" onClick={() => popout(localStream, `${name} • ${sharing ? 'Tela' : 'Câmera'}`)}>↗ <span>Abrir janela</span></button>
          <button className="danger" onClick={leave}>☎ <span>Sair</span></button>
        </footer>
      </section>
    </main>
  );
}

function VideoTile({ streamRef, label, muted, onPop }) {
  return <div className="videoTile"><video ref={streamRef} autoPlay playsInline muted={muted}/><span className="videoLabel">{label}</span><button className="popBtn" onClick={onPop}>↗ Abrir em janela</button></div>;
}
function RemoteVideo({ stream, label, onPop }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <div className="videoTile"><video ref={ref} autoPlay playsInline/><span className="videoLabel">{label}</span><button className="popBtn" onClick={onPop}>↗ Abrir em janela</button></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
