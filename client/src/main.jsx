import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { io } from 'socket.io-client';
import './styles.css';

const SIGNALING =
  import.meta.env.VITE_SIGNALING_URL ||
  (window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin);

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'stun:stun.l.google.com:19302' }
];

function App() {
  const [name, setName] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [codeExpiresAt, setCodeExpiresAt] = useState(0);
  const [countdown, setCountdown] = useState('05:00');
  const [joined, setJoined] = useState(false);
  const [preCallMode, setPreCallMode] = useState(null);
  const [mediaMessage, setMediaMessage] = useState('');
  const [participants, setParticipants] = useState([]);
  const [quality, setQuality] = useState('1080');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [sharingCount, setSharingCount] = useState(0);
  const [status, setStatus] = useState('Pronto');
  const [remoteStreams, setRemoteStreams] = useState({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState({});
  const [turnEnabled, setTurnEnabled] = useState(false);
  const [peerStates, setPeerStates] = useState({});
  const [diagnostics, setDiagnostics] = useState({});
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const pendingIceRef = useRef(new Map());
  const mediaReadyPromiseRef = useRef(Promise.resolve());
  const wantsMicRef = useRef(true);
  const wantsCamRef = useRef(true);
  const remoteMediaRef = useRef(new Map());
  // Compartilhamento usa PeerConnections separados da call.
  // Assim tela nunca renegocia nem altera o áudio/câmera que já estão funcionando.
  const screenPeersRef = useRef(new Map());
  const pendingScreenIceRef = useRef(new Map());

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

  function refreshLocalPreview() {
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
  }

  function ensureBaseStream() {
    if (!localStreamRef.current) localStreamRef.current = new MediaStream();
    return localStreamRef.current;
  }

  async function ensureAudio() {
    const base = ensureBaseStream();
    if (base.getAudioTracks().length) return true;
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      audioStream.getAudioTracks().forEach(track => base.addTrack(track));
      setMicOn(true);
      setMediaMessage('');
      refreshLocalPreview();
      return true;
    } catch (e) {
      console.warn('Microfone indisponível:', e);
      setMicOn(false);
      setMediaMessage('Microfone indisponível. Você ainda pode entrar na call.');
      return false;
    }
  }

  async function ensureVideo() {
    const base = ensureBaseStream();
    if (base.getVideoTracks().length) return true;
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
      });
      videoStream.getVideoTracks().forEach(track => base.addTrack(track));
      setCamOn(true);
      setMediaMessage('');
      refreshLocalPreview();
      return true;
    } catch (e) {
      console.warn('Câmera indisponível:', e);
      setCamOn(false);
      setMediaMessage('Câmera indisponível. Você ainda pode entrar normalmente.');
      return false;
    }
  }

  async function loadIceConfig() {
    try {
      const response = await fetch(`${SIGNALING}/ice-config`, { cache: 'no-store' });
      if (!response.ok) throw new Error('ICE config indisponível');
      const data = await response.json();
      if (Array.isArray(data.iceServers) && data.iceServers.length) {
        iceServersRef.current = data.iceServers;
      }
      setTurnEnabled(Boolean(data.turnEnabled));
      return Boolean(data.turnEnabled);
    } catch (e) {
      console.warn('Falha ao carregar TURN; usando STUN padrão:', e);
      iceServersRef.current = DEFAULT_ICE_SERVERS;
      setTurnEnabled(false);
      return false;
    }
  }

  function queueIce(peerId, candidate) {
    const list = pendingIceRef.current.get(peerId) || [];
    list.push(candidate);
    pendingIceRef.current.set(peerId, list);
  }

  async function flushIce(peerId, pc) {
    const list = pendingIceRef.current.get(peerId) || [];
    pendingIceRef.current.delete(peerId);
    for (const candidate of list) {
      try { await pc.addIceCandidate(candidate); }
      catch (e) { console.warn('ICE pendente rejeitado:', e); }
    }
  }

  async function preparePreview(mode) {
    if (!name.trim()) return alert('Digite seu nome.');
    if (mode === 'join' && !codeInput.trim()) return alert('Digite o código da sala.');
    setPreCallMode(mode);
    setStatus('Preparando câmera e microfone...');
    ensureBaseStream();

    const mediaPromise = Promise.allSettled([
      wantsMicRef.current ? ensureAudio() : Promise.resolve(false),
      wantsCamRef.current ? ensureVideo() : Promise.resolve(false),
      loadIceConfig()
    ]);

    mediaReadyPromiseRef.current = mediaPromise;
    await mediaPromise;
    setStatus('Pronto para entrar');
  }

  async function waitForLocalMedia() {
    try {
      await mediaReadyPromiseRef.current;
    } catch (_) {}

    const base = ensureBaseStream();

    // Se o usuário quer microfone e ele ainda não existe, tenta novamente
    // antes da primeira negociação WebRTC.
    if (wantsMicRef.current && base.getAudioTracks().length === 0) {
      await ensureAudio();
    }

    return base;
  }

  async function attachLocalTracks(pc) {
    const stream = await waitForLocalMedia();

    for (const track of stream.getTracks()) {
      const sameKindSender = pc.getSenders().find(s => s.track?.kind === track.kind);
      if (!sameKindSender) {
        pc.addTrack(track, stream);
      } else if (sameKindSender.track !== track) {
        await sameKindSender.replaceTrack(track);
      }
    }

    // Mantém os transceivers bidirecionais quando houver mídia local.
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.sender?.track && transceiver.direction !== 'sendrecv') {
        try { transceiver.direction = 'sendrecv'; } catch (_) {}
      }
    }
  }

  function createPeer(targetId) {
    if (peersRef.current.has(targetId)) return peersRef.current.get(targetId);
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pc.onicecandidate = e => {
      if (e.candidate) socketRef.current?.emit('webrtc-ice-candidate', { target: targetId, candidate: e.candidate });
    };
    pc.ontrack = e => {
      // Não depende de event.streams[0]. Alguns navegadores/conexões
      // entregam a track corretamente, mas streams[] vem vazio.
      let remote = remoteMediaRef.current.get(targetId);
      if (!remote) {
        remote = new MediaStream();
        remoteMediaRef.current.set(targetId, remote);
      }

      const already = remote.getTracks().some(t => t.id === e.track.id);
      if (!already) remote.addTrack(e.track);

      // Atualiza o React com um objeto MediaStream válido em qualquer caso.
      setRemoteStreams(prev => ({ ...prev, [targetId]: remote }));

      const refreshDiag = () => {
        const audioTracks = remote.getAudioTracks();
        const videoTracks = remote.getVideoTracks();
        setDiagnostics(prev => ({
          ...prev,
          [targetId]: {
            ...(prev[targetId] || {}),
            receivedAudio: audioTracks.length,
            receivedVideo: videoTracks.length,
            audioState: audioTracks[0]?.readyState || 'none',
            videoState: videoTracks[0]?.readyState || 'none'
          }
        }));
      };

      refreshDiag();
      e.track.onunmute = refreshDiag;
      e.track.onmute = refreshDiag;
      e.track.onended = refreshDiag;
    };
    const updatePeerState = () => {
      const value = pc.connectionState || pc.iceConnectionState || 'new';
      setPeerStates(prev => ({ ...prev, [targetId]: value }));
      setDiagnostics(prev => ({
        ...prev,
        [targetId]: {
          ...(prev[targetId] || {}),
          connection: pc.connectionState || 'new',
          ice: pc.iceConnectionState || 'new',
          signaling: pc.signalingState || 'stable',
          localAudioSenders: pc.getSenders().filter(s => s.track?.kind === 'audio').length,
          localVideoSenders: pc.getSenders().filter(s => s.track?.kind === 'video').length,
          remoteAudioReceivers: pc.getReceivers().filter(r => r.track?.kind === 'audio').length,
          remoteVideoReceivers: pc.getReceivers().filter(r => r.track?.kind === 'video').length
        }
      }));
      if (value === 'connected') setStatus(turnEnabled ? 'Mídia conectada • TURN disponível' : 'Mídia conectada');
      if (value === 'failed') setStatus('Falha na conexão de mídia');
    };
    pc.onconnectionstatechange = updatePeerState;
    pc.oniceconnectionstatechange = updatePeerState;
    peersRef.current.set(targetId, pc);
    return pc;
  }

  async function makeOffer(targetId) {
    const pc = createPeer(targetId);

    // CRÍTICO: o participante que entra só cria a oferta depois
    // que o microfone/câmera realmente foram anexados ao PeerConnection.
    await attachLocalTracks(pc);

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await pc.setLocalDescription(offer);
    socketRef.current.emit('webrtc-offer', { target: targetId, offer });
  }


  function queueScreenIce(peerId, candidate) {
    if (!pendingScreenIceRef.current.has(peerId)) pendingScreenIceRef.current.set(peerId, []);
    pendingScreenIceRef.current.get(peerId).push(candidate);
  }

  async function flushScreenIce(peerId, pc) {
    const queued = pendingScreenIceRef.current.get(peerId) || [];
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); }
      catch (e) { console.warn('Screen ICE rejeitado:', e); }
    }
    pendingScreenIceRef.current.delete(peerId);
  }

  function createScreenPeer(targetId, receiving = false) {
    const existing = screenPeersRef.current.get(targetId);
    if (existing && existing.connectionState !== 'closed') return existing;

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pc.onicecandidate = e => {
      if (e.candidate) {
        socketRef.current?.emit('screen-ice-candidate', {
          target: targetId,
          candidate: e.candidate
        });
      }
    };

    pc.ontrack = e => {
      if (e.track.kind !== 'video') return;
      const stream = new MediaStream([e.track]);
      setRemoteScreenStreams(prev => ({ ...prev, [targetId]: stream }));
      e.track.onended = () => {
        setRemoteScreenStreams(prev => {
          const next = { ...prev };
          delete next[targetId];
          return next;
        });
      };
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        screenPeersRef.current.delete(targetId);
      }
    };

    screenPeersRef.current.set(targetId, pc);
    return pc;
  }

  async function offerScreenTo(targetId) {
    const track = screenStreamRef.current?.getVideoTracks()[0];
    if (!track || targetId === socketRef.current?.id) return;

    let pc = screenPeersRef.current.get(targetId);
    if (pc && ['connected', 'connecting'].includes(pc.connectionState)) return;

    if (pc) {
      try { pc.close(); } catch (_) {}
      screenPeersRef.current.delete(targetId);
    }

    pc = createScreenPeer(targetId);
    pc.addTrack(track, screenStreamRef.current);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('screen-offer', { target: targetId, offer });
  }

  async function offerScreenToParticipants(list = participants) {
    if (!screenStreamRef.current) return;
    for (const person of list) {
      if (person.socketId !== socketRef.current?.id) {
        try { await offerScreenTo(person.socketId); }
        catch (e) { console.warn('Falha ao enviar tela para', person.socketId, e); }
      }
    }
  }

  function closeScreenPeer(peerId) {
    const pc = screenPeersRef.current.get(peerId);
    try { pc?.close(); } catch (_) {}
    screenPeersRef.current.delete(peerId);
    pendingScreenIceRef.current.delete(peerId);
    setRemoteScreenStreams(prev => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
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
      if (screenStreamRef.current) {
        setTimeout(() => offerScreenToParticipants(list), 0);
      }
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
      await flushIce(from, pc);

      // Garante que quem já estava na sala também anexe sua mídia
      // antes de responder à negociação.
      await attachLocalTracks(pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', { target: from, answer });
    });
    socket.on('webrtc-answer', async ({ from, answer }) => {
      const pc = peersRef.current.get(from);
      if (pc && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(answer);
        await flushIce(from, pc);
      }
    });
    socket.on('webrtc-ice-candidate', async ({ from, candidate }) => {
      const pc = createPeer(from);
      if (!pc.remoteDescription) {
        queueIce(from, candidate);
        return;
      }
      try { await pc.addIceCandidate(candidate); }
      catch (e) { console.warn('ICE candidate rejeitado:', e); }
    });

    socket.on('screen-offer', async ({ from, offer }) => {
      try {
        closeScreenPeer(from);
        const pc = createScreenPeer(from, true);
        await pc.setRemoteDescription(offer);
        await flushScreenIce(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('screen-answer', { target: from, answer });
      } catch (e) {
        console.error('Falha ao receber compartilhamento:', e);
      }
    });

    socket.on('screen-answer', async ({ from, answer }) => {
      const pc = screenPeersRef.current.get(from);
      if (!pc) return;
      try {
        if (!pc.currentRemoteDescription) {
          await pc.setRemoteDescription(answer);
          await flushScreenIce(from, pc);
        }
      } catch (e) {
        console.warn('Screen answer rejeitada:', e);
      }
    });

    socket.on('screen-ice-candidate', async ({ from, candidate }) => {
      let pc = screenPeersRef.current.get(from);
      if (!pc) {
        queueScreenIce(from, candidate);
        return;
      }
      if (!pc.remoteDescription) {
        queueScreenIce(from, candidate);
        return;
      }
      try { await pc.addIceCandidate(candidate); }
      catch (e) { console.warn('Screen ICE rejeitado:', e); }
    });

    socket.on('screen-share-stopped', ({ from }) => {
      closeScreenPeer(from);
    });

    socket.on('user-left', ({ socketId }) => {
      peersRef.current.get(socketId)?.close();
      peersRef.current.delete(socketId);
      closeScreenPeer(socketId);
      remoteMediaRef.current.delete(socketId);
      setRemoteStreams(prev => { const n = { ...prev }; delete n[socketId]; return n; });
      setDiagnostics(prev => { const n = { ...prev }; delete n[socketId]; return n; });
    });
    return socket;
  }

  async function enterSelectedRoom() {
    try {
      // Não deixa a entrada correr na frente da captura de mídia.
      await waitForLocalMedia();
      if (!iceServersRef.current?.length) await loadIceConfig();
      const socket = await connectSocket();
      const currentMode = preCallMode;
      if (currentMode === 'create') {
        socket.emit('create-room', { name: name.trim() }, res => {
          if (!res?.ok) return alert(res?.error || 'Não foi possível criar a sala.');
          setRoomCode(res.code);
          setCodeExpiresAt(res.expiresAt);
          setPreCallMode(null);
          setJoined(true);
          setStatus('Sala criada');
          setTimeout(refreshLocalPreview, 50);
        });
      } else {
        socket.emit('join-room', { code: codeInput.trim().toUpperCase(), name: name.trim() }, res => {
          if (!res?.ok) return alert(res?.error || 'Não foi possível entrar.');
          setRoomCode(res.code);
          setCodeExpiresAt(res.expiresAt);
          setPreCallMode(null);
          setJoined(true);
          setStatus('Conectado');
          setTimeout(refreshLocalPreview, 50);
        });
      }
    } catch (e) {
      alert(e.message || 'Não foi possível conectar ao servidor.');
    }
  }

  function createRoom() {
    preparePreview('create');
  }

  function joinRoom() {
    preparePreview('join');
  }

  async function copyCode() {
    await navigator.clipboard.writeText(roomCode);
    setStatus('Código copiado');
  }

  async function toggleMic() {
    wantsMicRef.current = !micOn;
    const tracks = localStreamRef.current?.getAudioTracks() || [];
    if (!tracks.length) {
      const ok = await ensureAudio();
      if (ok && joined) await syncNewTracks();
      return;
    }
    tracks.forEach(t => t.enabled = !micOn);
    setMicOn(v => !v);
  }

  async function toggleCam() {
    wantsCamRef.current = !camOn;
    const tracks = localStreamRef.current?.getVideoTracks() || [];
    if (!tracks.length) {
      const ok = await ensureVideo();
      if (ok && joined) await syncNewTracks();
      return;
    }
    tracks.forEach(t => t.enabled = !camOn);
    setCamOn(v => !v);
  }

  async function syncNewTracks() {
    const stream = localStreamRef.current;
    if (!stream) return;
    for (const [targetId, pc] of peersRef.current.entries()) {
      for (const track of stream.getTracks()) {
        const sender = pc.getSenders().find(s => s.track?.kind === track.kind);
        if (!sender) pc.addTrack(track, stream);
        else if (sender.track !== track) await sender.replaceTrack(track);
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit('webrtc-offer', { target: targetId, offer });
    }
    refreshLocalPreview();
  }

  async function shareScreen() {
    if (sharing) return stopScreenShare();

    socketRef.current.emit('request-screen-share', {}, async res => {
      if (!res?.ok) return alert(res?.error || 'Não foi possível compartilhar.');

      try {
        const is1080 = quality === '1080';
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: is1080 ? 1920 : 1280 },
            height: { ideal: is1080 ? 1080 : 720 },
            frameRate: { ideal: 30, max: 60 }
          },
          // O áudio da call continua no PeerConnection principal.
          // Não misturamos áudio do compartilhamento com o microfone.
          audio: false
        });

        screenStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error('Nenhuma track de tela foi capturada.');

        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        track.onended = () => stopScreenShare();

        setSharing(true);
        setStatus(`Compartilhando ${quality}p`);

        // Canal WebRTC EXCLUSIVO para tela. Não toca na call principal.
        await offerScreenToParticipants(participants);
      } catch (e) {
        console.error('Falha ao compartilhar tela:', e);
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        screenStreamRef.current = null;
        socketRef.current?.emit('stop-screen-share');
        setSharing(false);
        setStatus('Falha ao compartilhar tela');
      }
    });
  }

  async function stopScreenShare() {
    const track = screenStreamRef.current?.getVideoTracks()[0];
    if (track) track.onended = null;
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    for (const [peerId, pc] of screenPeersRef.current.entries()) {
      try { pc.close(); } catch (_) {}
      socketRef.current?.emit('screen-share-stop-peer', { target: peerId });
    }
    screenPeersRef.current.clear();
    pendingScreenIceRef.current.clear();

    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    socketRef.current?.emit('stop-screen-share');
    setSharing(false);
    setStatus('Compartilhamento encerrado');
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
    screenPeersRef.current.forEach(pc => pc.close());
    screenPeersRef.current.clear();
    pendingScreenIceRef.current.clear();
    setRemoteScreenStreams({});
    pendingIceRef.current.clear();
    remoteMediaRef.current.clear();
    setPeerStates({});
    setDiagnostics({});
    socketRef.current?.disconnect();
  }

  function leave() {
    socketRef.current?.emit('leave-room');
    cleanup();
    setJoined(false); setParticipants([]); setRemoteStreams({}); setRoomCode(''); setCodeInput('');
  }

  if (!joined && preCallMode) return (
    <main className="landing">
      <div className="brand brandCenter">
        <div className="secretLogo"><span>SECRET</span><small>CALL</small></div>
        <p>Antes de entrar, escolha como quer participar.</p>
      </div>
      <div className="preCallCard">
        <div className="previewBox">
          <video ref={localVideoRef} autoPlay playsInline muted />
          {!camOn && <div className="cameraOff">Câmera desligada</div>}
          <span>{name}</span>
        </div>
        {mediaMessage && <div className="mediaNotice">{mediaMessage}</div>}
        <div className="preControls">
          <button className={micOn ? '' : 'off'} onClick={toggleMic}>{micOn ? '🎤 Microfone ligado' : '🔇 Ligar microfone'}</button>
          <button className={camOn ? '' : 'off'} onClick={toggleCam}>{camOn ? '📹 Câmera ligada' : '🚫 Tentar ligar câmera'}</button>
        </div>
        <div className="preCallInfo">
          <b>{preCallMode === 'create' ? 'Criar nova sala' : `Entrar com código ${codeInput.toUpperCase()}`}</b>
          <span>Mesmo sem câmera ou microfone você pode entrar.</span>
        </div>
        <button className="primary" onClick={enterSelectedRoom}>Entrar na call</button>
        <button className="secondary" onClick={() => setPreCallMode(null)}>Voltar</button>
      </div>
    </main>
  );

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
          <div className="topStats"><button className="diagToggle" onClick={() => setShowDiagnostics(v => !v)}>🔧 Diagnóstico</button><span className={turnEnabled ? 'turnBadge turnOn' : 'turnBadge'}>{turnEnabled ? '🛡 TURN ativo' : '⚠ TURN inativo'}</span><span>🖥 {sharingCount}/3 compartilhando</span><div className="quality"><span>Qualidade</span><select value={quality} onChange={e => setQuality(e.target.value)}><option value="720">720p</option><option value="1080">1080p</option></select></div></div>
        </header>
        {showDiagnostics && <div className="diagPanel">
          <b>Diagnóstico WebRTC</b>
          {participants.filter(p => p.socketId !== socketRef.current?.id).length === 0 && <span>Nenhum peer remoto conectado.</span>}
          {participants.filter(p => p.socketId !== socketRef.current?.id).map(p => {
            const d = diagnostics[p.socketId] || {};
            return <div className="diagPeer" key={p.socketId}>
              <strong>{p.name}</strong>
              <span>Conexão: {d.connection || peerStates[p.socketId] || 'new'}</span>
              <span>ICE: {d.ice || 'new'}</span>
              <span>Enviando: áudio {d.localAudioSenders ?? 0} • vídeo {d.localVideoSenders ?? 0}</span>
              <span>Receivers: áudio {d.remoteAudioReceivers ?? 0} • vídeo {d.remoteVideoReceivers ?? 0}</span>
              <span>Tracks recebidas: áudio {d.receivedAudio ?? 0} ({d.audioState || 'none'}) • vídeo {d.receivedVideo ?? 0} ({d.videoState || 'none'})</span>
            </div>;
          })}
        </div>}
        <div className="videoGrid">
          <VideoTile streamRef={localVideoRef} label={`${name} (você)${sharing ? ' • TELA' : ''}`} muted onPop={() => popout(localStream, `${name} • ${sharing ? 'Tela' : 'Câmera'}`)} />
          {Object.entries(remoteStreams).map(([id, stream]) => {
            const p = participants.find(x => x.socketId === id);
            const label = `${p?.name || 'Convidado'}${p?.sharing ? ' • TELA' : ''}`;
            const state = peerStates[id] || 'conectando';
            return <RemoteVideo key={id} stream={stream} label={`${label} • ${state}`} onPop={() => popout(stream, label)} />;
          })}
          {Object.entries(remoteScreenStreams).map(([id, stream]) => {
            const p = participants.find(x => x.socketId === id);
            const label = `${p?.name || 'Convidado'} • TELA`;
            return <RemoteVideo key={`screen-${id}`} stream={stream} label={label} onPop={() => popout(stream, label)} />;
          })}
          {Object.keys(remoteStreams).length === 0 && Object.keys(remoteScreenStreams).length === 0 && <div className="emptyTile"><div className="emptyIcon">#</div><h3>{roomCode}</h3><p>Envie apenas este código para seus amigos.</p><button onClick={copyCode}>Copiar código</button></div>}
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
  useEffect(() => {
    const video = ref.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    const p = video.play();
    if (p?.catch) p.catch(err => console.warn('Autoplay remoto bloqueado:', err));
  }, [stream]);
  return <div className="videoTile"><video ref={ref} autoPlay playsInline/><span className="videoLabel">{label}</span><button className="popBtn" onClick={onPop}>↗ Abrir em janela</button></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
