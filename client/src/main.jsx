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
  const [chatOpen, setChatOpen] = useState(true);
  const [peopleOpen, setPeopleOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState('grid');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [micVolume, setMicVolume] = useState(80);
  const [shareVolume, setShareVolume] = useState(70);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingUrl, setRecordingUrl] = useState('');
  const [toast, setToast] = useState('');

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
  const recorderRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  useEffect(() => () => cleanup(), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [recordingUrl]);

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
      let stream = null;

      setRemoteScreenStreams(prev => {
        stream = prev[targetId] || new MediaStream();

        const exists = stream.getTracks().some(t => t.id === e.track.id);
        if (!exists) stream.addTrack(e.track);

        return { ...prev, [targetId]: stream };
      });

      e.track.onended = () => {
        setRemoteScreenStreams(prev => {
          const current = prev[targetId];
          if (!current) return prev;

          try { current.removeTrack(e.track); } catch (_) {}

          // Mantém o tile enquanto existir vídeo ou áudio da transmissão.
          if (current.getTracks().length === 0) {
            const next = { ...prev };
            delete next[targetId];
            return next;
          }

          return { ...prev, [targetId]: current };
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

    // Envia imagem + áudio da transmissão, se o navegador disponibilizar.
    for (const mediaTrack of screenStreamRef.current.getTracks()) {
      pc.addTrack(mediaTrack, screenStreamRef.current);
    }

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

    socket.on('chat-history', messages => {
      if (Array.isArray(messages)) setChatMessages(messages);
    });

    socket.on('chat-message', message => {
      setChatMessages(prev => [...prev.slice(-99), message]);
    });
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
          // Áudio do compartilhamento fica no PeerConnection exclusivo da tela.
          // O microfone da call principal continua separado.
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          },
          // Hints suportados por navegadores Chromium quando disponíveis.
          systemAudio: 'include',
          surfaceSwitching: 'include'
        });

        screenStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error('Nenhuma track de tela foi capturada.');

        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        track.onended = () => stopScreenShare();

        const hasShareAudio = stream.getAudioTracks().length > 0;

        setSharing(true);
        setStatus(
          hasShareAudio
            ? `Compartilhando ${quality}p • áudio da transmissão ativo`
            : `Compartilhando ${quality}p • sem áudio da transmissão`
        );

        // Canal WebRTC EXCLUSIVO para tela. Não toca na call principal.
        await offerScreenToParticipants(participants);
      } catch (e) {
        console.error('Falha ao compartilhar tela:', e);
        if (recording) stopRecording();
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


  function copyInviteCode() {
    if (!roomCode) return;
    navigator.clipboard?.writeText(roomCode);
    setToast('Código copiado');
  }

  function sendChat() {
    const text = chatInput.trim();
    if (!text || !socketRef.current?.connected) return;
    socketRef.current.emit('chat-message', { text }, res => {
      if (!res?.ok) setToast(res?.error || 'Não foi possível enviar');
    });
    setChatInput('');
  }

  function toggleLayout() {
    setLayoutMode(v => v === 'grid' ? 'focus' : 'grid');
    setToast(layoutMode === 'grid' ? 'Layout foco ativado' : 'Layout grade ativado');
  }

  async function startRecording() {
    if (recording) return stopRecording();

    let source = null;
    if (screenStreamRef.current) {
      source = screenStreamRef.current;
    } else if (localStreamRef.current?.getTracks().length) {
      source = localStreamRef.current;
    }

    if (!source || source.getTracks().length === 0) {
      setToast('Ative câmera/microfone ou compartilhe a tela para gravar');
      return;
    }

    try {
      const tracks = source.getTracks().filter(t => t.readyState === 'live');
      const recordStream = new MediaStream(tracks);

      const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
      ];
      const mimeType = candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';

      recorderChunksRef.current = [];
      const recorder = new MediaRecorder(recordStream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = e => {
        if (e.data?.size) recorderChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || 'video/webm' });
        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        const url = URL.createObjectURL(blob);
        setRecordingUrl(url);
        setToast('Gravação pronta para baixar');
      };

      recorder.start(1000);
      setRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(v => v + 1), 1000);
      setToast('Gravação iniciada');
    } catch (e) {
      console.error('Falha ao gravar:', e);
      setToast('Não foi possível iniciar a gravação');
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    setRecording(false);
  }

  function formatRecordingTime(sec) {
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
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
    <main className="landing finalLanding">
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
    <main className="landing finalLanding">
      <div className="brand brandCenter">
        <div className="secretLogo"><span>SECRET</span><small>CALL</small></div>
        <p>Call privada • até 10 pessoas • código temporário</p>
      </div>
      <div className="joinCard finalJoinCard">
        <label>Seu nome</label>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Gah Secret" />
        <div className="divider"><span>CRIAR</span></div>
        <button className="primary" onClick={createRoom}>Criar nova sala</button>
        <div className="divider"><span>OU ENTRAR</span></div>
        <label>Código da sala</label>
        <input value={codeInput} onChange={e => setCodeInput(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" />
        <button className="secondary" onClick={joinRoom}>Entrar com código</button>
      </div>
      <div className="features finalFeatures"><span>👥 10 pessoas</span><span>🖥 até 3 compartilhando</span><span>⏱ código troca em 5 min</span><span>🪟 janela para 2º monitor</span></div>
    </main>
  );

  const localStream = sharing ? screenStreamRef.current : localStreamRef.current;
  return (
    <main className={`gamerShell layout-${layoutMode}`}>
      {toast && <div className="toast">{toast}</div>}

      <aside className="gamerLeft">
        <div className="gamerBrand">
          <div className="gamerLogo">S</div>
          <div><b>SECRET</b> <span>CALL</span></div>
        </div>

        <div className="sideSection">
          <div className="sideTitle">PARTICIPANTES ({participants.length})</div>
          <div className="participantStack">
            {participants.map(p => {
              const isMe = p.socketId === socketRef.current?.id;
              return <div className={`gamerParticipant ${isMe ? 'me' : ''}`} key={p.socketId}>
                <div className="avatarCircle">{(p.name || '?').slice(0,1).toUpperCase()}</div>
                <div className="participantName">
                  <strong>{isMe ? 'Você' : p.name}</strong>
                  {isMe && <small>Host</small>}
                </div>
                <div className={`voicePulse ${p.sharing ? 'active' : ''}`}>▮▮▮</div>
              </div>;
            })}
          </div>

          <button className="wideGhost" onClick={copyInviteCode}>👥 Convidar pessoas</button>
        </div>

        <div className="roomInfoCard">
          <div className="sideTitle">INFORMAÇÕES DA SALA</div>
          <div className="roomInfoRow"><span>ID da sala</span><b>{roomCode}</b></div>
          <div className="roomInfoRow"><span>Expira</span><b>{countdown}</b></div>
          <div className="roomInfoRow"><span>Segurança</span><b>TURN ativo</b></div>
          <div className="roomInfoRow"><span>Conexão</span><b className="good">Excelente</b></div>
        </div>

        <div className="experienceCard">
          <div className="diamond">◇</div>
          <div>
            <b>Secret Call</b>
            <small>10 pessoas • 3 telas • 1080p</small>
          </div>
        </div>

        <div className="leftFooter">
          <button onClick={() => setSettingsOpen(true)}>⚙</button>
          <button onClick={() => setPeopleOpen(v => !v)}>👥</button>
          <button onClick={() => setShowDiagnostics(v => !v)}>🛡</button>
          <button onClick={() => setToast('Mais opções em breve')}>•••</button>
        </div>
      </aside>

      <section className="gamerMain">
        <header className="gamerTop">
          <div className="protected">🔒 Sala protegida</div>
          <button className="roomCodeTop" onClick={copyInviteCode}>{roomCode} <span>⧉</span></button>
          <div className="topCount">👥 {participants.length} participantes</div>
          <button className={layoutMode === 'grid' ? 'topBtn active' : 'topBtn'} onClick={toggleLayout}>▦ Grade</button>
          <button className="topBtn" onClick={() => document.documentElement.requestFullscreen?.()}>⛶</button>
          <button className="topBtn" onClick={() => setSettingsOpen(true)}>•••</button>
        </header>

        {showDiagnostics && <div className="diagPanel gamerDiag">
          <b>Diagnóstico WebRTC</b>
          {participants.filter(p => p.socketId !== socketRef.current?.id).length === 0 && <span>Nenhum peer remoto conectado.</span>}
          {participants.filter(p => p.socketId !== socketRef.current?.id).map(p => {
            const d = diagnostics[p.socketId] || {};
            return <div className="diagPeer" key={p.socketId}>
              <strong>{p.name}</strong>
              <span>Conexão: {d.connection || peerStates[p.socketId] || 'new'}</span>
              <span>ICE: {d.ice || 'new'}</span>
              <span>Áudio recebido: {d.receivedAudio ?? 0}</span>
              <span>Vídeo recebido: {d.receivedVideo ?? 0}</span>
            </div>;
          })}
        </div>}

        <div className="gamerStage">
          <div className={`gamerVideoGrid ${layoutMode}`}>
            <VideoTile
              streamRef={localVideoRef}
              label={`${name} (você)${sharing ? ' • TELA' : ''}`}
              muted
              onPop={() => popout(localStream, `${name} • ${sharing ? 'Tela' : 'Câmera'}`)}
            />

            {Object.entries(remoteStreams).map(([id, stream]) => {
              const p = participants.find(x => x.socketId === id);
              const label = p?.name || 'Convidado';
              return <RemoteVideo
                key={`call-${id}`}
                stream={stream}
                label={label}
                volume={micVolume / 100}
                onPop={() => popout(stream, label)}
              />;
            })}

            {Object.entries(remoteScreenStreams).map(([id, stream]) => {
              const p = participants.find(x => x.socketId === id);
              const label = `Tela de ${p?.name || 'Convidado'}`;
              return <RemoteVideo
                key={`screen-${id}`}
                stream={stream}
                label={label}
                volume={shareVolume / 100}
                onPop={() => popout(stream, label)}
              />;
            })}

            {Object.keys(remoteStreams).length === 0 && Object.keys(remoteScreenStreams).length === 0 && (
              <div className="waitingCard">
                <div className="waitingIcon">👥</div>
                <h3>Aguardando participantes...</h3>
                <p>Compartilhe o código da sala para convidar amigos.</p>
                <button onClick={copyInviteCode}>Copiar código</button>
              </div>
            )}
          </div>
        </div>

        <div className="gamerBottomControls finalCompactControls">
          <button className={micOn ? 'controlActive' : ''} onClick={toggleMic}>🎙<span>Microfone</span></button>
          <button className={camOn ? 'controlActive' : ''} onClick={toggleCam}>📹<span>Câmera</span></button>
          <button className={sharing ? 'controlShare active' : 'controlShare'} onClick={shareScreen}>🖥<span>{sharing ? 'Parar tela' : 'Tela'}</span></button>
          <button className={chatOpen ? 'controlActive' : ''} onClick={() => setChatOpen(v => !v)}>💬<span>Chat</span></button>
          <button className={peopleOpen ? 'controlActive' : ''} onClick={() => setPeopleOpen(v => !v)}>👥<span>Pessoas</span></button>
          <button className="leaveControl" onClick={leave}>☎<span>Sair</span></button>
        </div>

        <div className="bottomBrand">S <span>SECRET CALL</span></div>
      </section>

      <aside className={`gamerRight ${chatOpen ? '' : 'collapsed'}`}>
        {chatOpen && <>
          <div className="rightCard chatCard">
            <div className="rightTitle">CHAT DA SALA</div>
            <div className="chatMessages">
              {chatMessages.length === 0 && <div className="chatEmpty">Nenhuma mensagem ainda.</div>}
              {chatMessages.map((m, idx) => <div className="chatMsg" key={`${m.id || idx}-${idx}`}>
                <div className="chatAvatar">{(m.name || '?').slice(0,1).toUpperCase()}</div>
                <div><div className="chatMeta"><b>{m.name}</b><span>{m.time || ''}</span></div><p>{m.text}</p></div>
              </div>)}
            </div>
            <div className="chatInputRow">
              <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="Digite sua mensagem..." />
              <button onClick={sendChat}>➤</button>
            </div>
          </div>

          <div className="rightCard audioCard">
            <div className="rightTitle">CONTROLES DE ÁUDIO</div>
            <label>🎙 Microfone <span>{micVolume}%</span></label>
            <input type="range" min="0" max="100" value={micVolume} onChange={e => setMicVolume(Number(e.target.value))}/>
            <label>🔊 Áudio da transmissão <span>{shareVolume}%</span></label>
            <input type="range" min="0" max="100" value={shareVolume} onChange={e => setShareVolume(Number(e.target.value))}/>
          </div>

          <div className="rightCard qualityCard">
            <div className="rightTitle">QUALIDADE DA CHAMADA</div>
            <strong>Excelente</strong>
            <span>{quality}p • TURN ativo</span>
            <div className="qualityBars">▂▄▆█</div>
          </div>

          <div className="rightActions">
            <button className={recording ? 'recording' : ''} onClick={startRecording}>
              ⏺ {recording ? formatRecordingTime(recordingSeconds) : 'Gravar'}
            </button>
            <button onClick={toggleLayout}>▦ Layout</button>
            <button onClick={() => setSettingsOpen(true)}>⚙ Config.</button>
          </div>

          {recordingUrl && <a className="downloadRecord" href={recordingUrl} download={`secret-call-${Date.now()}.webm`}>⬇ Baixar gravação</a>}
        </>}
      </aside>

      {settingsOpen && <div className="modalOverlay" onClick={() => setSettingsOpen(false)}>
        <div className="settingsModal" onClick={e => e.stopPropagation()}>
          <div className="settingsHead"><h3>Configurações</h3><button onClick={() => setSettingsOpen(false)}>✕</button></div>
          <div className="settingGroup">
            <label>Qualidade da transmissão</label>
            <select value={quality} onChange={e => setQuality(e.target.value)}>
              <option value="720">720p</option>
              <option value="1080">1080p</option>
            </select>
          </div>
          <div className="settingGroup">
            <label>Layout</label>
            <div className="segmented">
              <button className={layoutMode === 'grid' ? 'active' : ''} onClick={() => setLayoutMode('grid')}>Grade</button>
              <button className={layoutMode === 'focus' ? 'active' : ''} onClick={() => setLayoutMode('focus')}>Foco</button>
            </div>
          </div>
          <div className="settingGroup">
            <label>Diagnóstico</label>
            <button className="wideGhost" onClick={() => setShowDiagnostics(v => !v)}>{showDiagnostics ? 'Ocultar diagnóstico' : 'Mostrar diagnóstico'}</button>
          </div>
          <button className="modalDone" onClick={() => setSettingsOpen(false)}>Concluído</button>
        </div>
      </div>}
    </main>
  );
}

function VideoTile({ streamRef, label, muted, onPop }) {
  return <div className="videoTile"><video ref={streamRef} autoPlay playsInline muted={muted}/><span className="videoLabel">{label}</span><button className="popBtn" onClick={onPop}>↗ Abrir em janela</button></div>;
}
function RemoteVideo({ stream, label, onPop, volume = 1 }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;

    video.muted = false;
    video.volume = Math.max(0, Math.min(1, volume));

    const tryPlay = () => {
      const p = video.play();
      if (p?.catch) p.catch(err => console.warn('Autoplay remoto bloqueado:', err));
    };

    tryPlay();

    stream.getTracks().forEach(track => {
      track.onunmute = tryPlay;
    });
  }, [stream, volume]);

  return <div className="videoTile">
    <video ref={ref} autoPlay playsInline/>
    <span className="videoLabel">{label}</span>
    <button className="popBtn" onClick={onPop}>↗ Abrir em janela</button>
  </div>;
}

createRoot(document.getElementById('root')).render(<App/>);
