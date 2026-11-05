/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Volume2 } from 'lucide-react';

const OPTIMIZED_VIDEO_URL = '/video/vinicunca_1080p.mp4';
const SEAMLESS_VIDEO_URL = '/video/vinicunca_seamless_turn.mp4';
const FALLBACK_VIDEO_URL =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260601_110537_3a579fa0-7bbc-4d94-9d25-0e816c7840f5.mp4';

const WELCOME_PHRASE =
  'Welcome to the Vinicunca. What is your name so I confirm your invitation?';

interface GuestRecord {
  id: string;
  name: string;
  tier: string;
  table: string;
  checkedInAt?: string | null;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Parallax tracking
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // State
  const [isAwake, setIsAwake] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [statusText, setStatusText] = useState('Tap the button to start the welcome assistant.');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [guestCount, setGuestCount] = useState(0);
  const [checkedInCount, setCheckedInCount] = useState(0);

  // Synchronous state refs to avoid effect race conditions
  const isAwakeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isInspectingRef = useRef(false);
  const phaseRef = useRef<'sleeping' | 'asking-name' | 'confirming' | 'checking'>('sleeping');
  const pendingGuestRef = useRef<GuestRecord | null>(null);
  const ignoredAudioUntilRef = useRef(0);

  // Recognition and Speech refs
  const recognitionRef = useRef<any>(null);
  const isRecognizingRef = useRef(false);
  const shouldListenRef = useRef(true);
  const cachedFemaleVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speechResumeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mutedGainRef = useRef<GainNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isSpeakingNowRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isAwakeRef.current = isAwake;
  }, [isAwake]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    isInspectingRef.current = isInspecting;
  }, [isInspecting]);

  // Pre-load and cache the highest-quality female voice
  const updateFemaleVoice = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    const femaleKeywords = [
      'Google UK English Female',
      'Google US English Female',
      'Samantha',
      'Victoria',
      'Karen',
      'Serena',
      'Moira',
      'Tessa',
      'Zira',
      'Jenny',
      'Aria',
      'Ava',
      'Allison',
      'Susan',
      'Fiona',
      'Female',
    ];

    for (const kw of femaleKeywords) {
      const match = voices.find(
        (v) => v.name.toLowerCase().includes(kw.toLowerCase()) && v.lang.startsWith('en')
      );
      if (match) {
        cachedFemaleVoiceRef.current = match;
        return;
      }
    }

    const fallback =
      voices.find((v) => v.name.toLowerCase().includes('female') && v.lang.startsWith('en')) ||
      voices.find((v) => v.lang.startsWith('en')) ||
      voices[0];

    cachedFemaleVoiceRef.current = fallback || null;
  }, []);

  useEffect(() => {
    updateFemaleVoice();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = updateFemaleVoice;
    }
  }, [updateFemaleVoice]);

  // Load the event's aggregate arrival count without sending the full list to the browser.
  useEffect(() => {
    fetch('/api/check-ins/stats')
      .then((res) => res.ok ? res.json() : Promise.reject(new Error('Guest list unavailable')))
      .then((data) => {
        setGuestCount(data.total ?? 0);
        setCheckedInCount(data.checkedIn ?? 0);
      })
      .catch(() => {
        setStatusText('Could not load the attendee list. Please ask the event team to check the server.');
      });
  }, []);

  // Safe video autoplay with user-gesture resilience
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.loop = true;
    video.playsInline = true;

    const playPromise = video.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Autoplay may be restricted before user clicks, safe silent catch
      });
    }
  }, []);

  // Adjust video animation speed when speaking vs idle
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (isInspecting) {
        video.playbackRate = 0.85;
      } else if (isSpeaking) {
        video.playbackRate = 1.15;
      } else {
        video.playbackRate = 0.95;
      }
    } catch {
      // Ignore if video element is not ready
    }
  }, [isSpeaking, isInspecting]);

  // Mouse parallax
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const { innerWidth, innerHeight } = window;
      const normalizedX = (e.clientX / innerWidth - 0.5) * 2;
      const normalizedY = (e.clientY / innerHeight - 0.5) * 2;
      setMousePos({ x: normalizedX, y: normalizedY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Use ElevenLabs for the event voice; retain the browser voice as an offline fallback.
  const speakInstantFemale = useCallback((text: string, onDone?: () => void) => {
    const finish = () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      isSpeakingNowRef.current = false;
      ignoredAudioUntilRef.current = Date.now() + 700;
      if (onDone) onDone();
    };

    const speakWithBrowserVoice = () => {
      if (!('speechSynthesis' in window)) {
        finish();
        return;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1.04;
      utterance.volume = 1;
      if (cachedFemaleVoiceRef.current) utterance.voice = cachedFemaleVoiceRef.current;
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    };

    setIsSpeaking(true);
    isSpeakingRef.current = true;
    isSpeakingNowRef.current = true;
    setStatusText('Speaking');
    if (speechResumeTimerRef.current) clearInterval(speechResumeTimerRef.current);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('ElevenLabs speech is unavailable');
        const blob = await response.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(audio.src);
          finish();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(audio.src);
          speakWithBrowserVoice();
        };
        try {
          await audio.play();
        } catch {
          speakWithBrowserVoice();
        }
      })
      .catch(() => speakWithBrowserVoice());
  }, []);

  const refreshAttendance = useCallback(async () => {
    const response = await fetch('/api/check-ins/stats');
    if (!response.ok) throw new Error('Attendance refresh failed');
    const stats = await response.json();
    setGuestCount(stats.total ?? 0);
    setCheckedInCount(stats.checkedIn ?? 0);
  }, []);

  const processGuestName = useCallback(async (spokenName: string) => {
    const cleanName = spokenName
      .replace(/\bmy name is\b/i, '')
      .replace(/\bi am\b/i, '')
      .replace(/\bi'm\b/i, '')
      .replace(/\bthis is\b/i, '')
      .replace(/\bplease\b/gi, '')
      .trim();
    if (cleanName.length < 2) {
      speakInstantFemale('I did not catch your name. Please say your full name.');
      return;
    }

    phaseRef.current = 'checking';
    setIsInspecting(true);
    isInspectingRef.current = true;
    setStatusText(`Checking ${cleanName}`);

    try {
      const response = await fetch('/api/check-in/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName }),
      });
      if (!response.ok) throw new Error('Attendee lookup failed');
      const result = await response.json();
      setIsInspecting(false);
      isInspectingRef.current = false;

      if (result.status === 'none' || !result.candidates?.length) {
        phaseRef.current = 'asking-name';
        setStatusText('Name not found; listening for another try');
        speakInstantFemale(`Sorry, I could not find ${cleanName} on the guest list. Please say your full name again, or see the registration team.`);
        return;
      }

      if (result.status === 'ambiguous') {
        phaseRef.current = 'asking-name';
        const names = result.candidates.map((guest: GuestRecord) => guest.name).join(', ');
        setStatusText('Several names are similar; asking for clarification');
        speakInstantFemale(`I found a few similar names: ${names}. Please say your full name clearly, or see the registration team.`);
        return;
      }

      const guest = result.candidates[0] as GuestRecord;
      if (guest.checkedInAt) {
        phaseRef.current = 'sleeping';
        setIsAwake(false);
        isAwakeRef.current = false;
        setStatusText(`${guest.name} already checked in`);
        speakInstantFemale(`${guest.name}, you are already checked in. Please enjoy the event.`);
        return;
      }

      pendingGuestRef.current = guest;
      phaseRef.current = 'confirming';
      setStatusText(`Confirming ${guest.name}`);
      speakInstantFemale(`I found ${guest.name}. Your table is ${guest.table}. Is that you? Please say yes or no.`);
    } catch (error) {
      console.error(error);
      phaseRef.current = 'asking-name';
      setIsInspecting(false);
      isInspectingRef.current = false;
      setStatusText('Could not reach the attendee list');
      speakInstantFemale('I am having trouble reaching the guest list. Please ask the registration team for help.');
    }
  }, [speakInstantFemale]);

  const confirmGuestCheckIn = useCallback(async () => {
    const guest = pendingGuestRef.current;
    if (!guest) {
      phaseRef.current = 'asking-name';
      speakInstantFemale('Please tell me your full name again.');
      return;
    }
    phaseRef.current = 'checking';
    setStatusText(`Recording ${guest.name}`);
    try {
      const response = await fetch('/api/check-in/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendeeId: guest.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Check-in could not be saved');
      pendingGuestRef.current = null;
      await refreshAttendance();
      phaseRef.current = 'sleeping';
      setIsAwake(false);
      isAwakeRef.current = false;
      if (result.status === 'already-checked-in') {
        setStatusText(`${guest.name} already checked in`);
        speakInstantFemale(`${guest.name}, you are already checked in. Please enjoy the event.`);
      } else {
        setStatusText(`${guest.name} is checked in`);
        speakInstantFemale(`Welcome to the Vinicunca, ${guest.name}. Your check-in is complete. Your table is ${guest.table}.`);
      }
    } catch (error) {
      console.error(error);
      phaseRef.current = 'confirming';
      setStatusText('Could not save the check-in');
      speakInstantFemale('I could not save your check-in just now. Please ask the registration team for help.');
    }
  }, [refreshAttendance, speakInstantFemale]);

  const handleTranscript = useCallback((transcript: string) => {
    const text = transcript.trim();
    if (!text || isSpeakingNowRef.current || Date.now() < ignoredAudioUntilRef.current) return;
    setLiveTranscript(text);
    const lower = text.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();

    if (phaseRef.current === 'sleeping') {
      const wake = /\b(?:hey\s+)?(vini|vinicunca)\b/i.exec(lower);
      if (!wake) return;
      setIsAwake(true);
      isAwakeRef.current = true;
      phaseRef.current = 'asking-name';
      const afterWake = lower.slice(wake.index + wake[0].length).replace(/^[,\s]+/, '').trim();
      if (afterWake.length > 2 && !/^(please|hello|hi|are you there)$/.test(afterWake)) {
        void processGuestName(afterWake);
      } else {
        setStatusText('Listening for the attendee name');
        speakInstantFemale(WELCOME_PHRASE);
      }
      return;
    }

    if (phaseRef.current === 'asking-name') {
      if (phaseRef.current !== 'checking') void processGuestName(text);
      return;
    }
    if (phaseRef.current === 'confirming') {
      if (/^(yes|yeah|yep|correct|that's me|that is me|it is|i am|i'm)(\b|$)/i.test(lower)) {
        void confirmGuestCheckIn();
      } else if (/^(no|nope|not me|that's not me|that is not me)(\b|$)/i.test(lower)) {
        pendingGuestRef.current = null;
        phaseRef.current = 'asking-name';
        setStatusText('Listening for the correct attendee name');
        speakInstantFemale('No problem. Please say your full name again.');
      } else {
        speakInstantFemale('Please say yes if that is you, or no if it is not.');
      }
    }
  }, [confirmGuestCheckIn, processGuestName, speakInstantFemale]);

  const startBrowserRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setStatusText('Live listening is unavailable in this browser. Use Chrome or Edge and allow microphone access.');
      setIsListening(false);
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-NG';
      recognition.onstart = () => {
        isRecognizingRef.current = true;
        setIsListening(true);
        setStatusText('Listening with browser speech recognition');
      };
      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result.isFinal && result[0]?.transcript) handleTranscript(result[0].transcript);
          else if (result[0]?.transcript) setLiveTranscript(result[0].transcript);
        }
      };
      recognition.onerror = (event: any) => {
        if (event.error === 'not-allowed') {
          shouldListenRef.current = false;
          setIsListening(false);
          setStatusText('Microphone permission was denied. Allow microphone access and try again.');
        }
      };
      recognition.onend = () => {
        isRecognizingRef.current = false;
        if (shouldListenRef.current) {
          window.setTimeout(() => {
            if (!shouldListenRef.current) return;
            try { recognition.start(); } catch { /* Browser is already restarting. */ }
          }, 350);
        }
      };
      recognitionRef.current = recognition;
      recognition.start();
    } catch (error) {
      console.error('Browser speech recognition could not start:', error);
      setIsListening(false);
      setStatusText('Could not start the microphone. Check browser permissions.');
    }
  }, [handleTranscript]);

  const startRealtimeListening = useCallback(async () => {
    shouldListenRef.current = true;
    setStatusText('Connecting to live listening');
    try {
      let context = audioContextRef.current;
      if (!context || context.state === 'closed') {
        context = new AudioContext();
        audioContextRef.current = context;
      }
      await context.resume();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const tokenResponse = await fetch('/api/scribe-token');
      if (!tokenResponse.ok) throw new Error('ElevenLabs live transcription is not configured');
      const { token } = await tokenResponse.json();
      if (!token) throw new Error('ElevenLabs did not return a temporary token');

      const params = new URLSearchParams({
        model_id: 'scribe_v2_realtime',
        audio_format: 'pcm_16000',
        sample_rate: '16000',
        commit_strategy: 'vad',
        language_code: 'en',
        keepalive_interval_ms: '1000',
      });
      params.append('keyterms', 'Vinicunca');
      params.append('keyterms', 'Vini');
      const socket = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}&token=${encodeURIComponent(token)}`);
      socketRef.current = socket;

      socket.onopen = () => setStatusText('Starting live listening');
      socket.onmessage = (event) => {
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.message_type === 'session_started') {
          setIsListening(true);
          setStatusText('Listening for your name');
          phaseRef.current = 'asking-name';
          setIsAwake(true);
          isAwakeRef.current = true;
          const audioContext = audioContextRef.current;
          if (!audioContext) {
            setStatusText('Audio could not be initialized. Click to restart.');
            socket.close();
            return;
          }
          const source = audioContext.createMediaStreamSource(stream);
          const processor = audioContext.createScriptProcessor(4096, 1, 1);
          const mutedGain = audioContext.createGain();
          mutedGain.gain.value = 0;
          sourceRef.current = source;
          processorRef.current = processor;
          mutedGainRef.current = mutedGain;
          processor.onaudioprocess = (audioEvent) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            const suppressMicrophone = isSpeakingNowRef.current || Date.now() < ignoredAudioUntilRef.current;
            const input = audioEvent.inputBuffer.getChannelData(0);
            const ratio = audioContext.sampleRate / 16000;
            const outputLength = Math.floor(input.length / ratio);
            const pcm = new Int16Array(outputLength);
            for (let i = 0; i < outputLength; i += 1) {
              if (suppressMicrophone) continue;
              const position = i * ratio;
              const low = Math.floor(position);
              const fraction = position - low;
              const sample = input[low] * (1 - fraction) + (input[Math.min(low + 1, input.length - 1)] || 0) * fraction;
              const clipped = Math.max(-1, Math.min(1, sample));
              pcm[i] = clipped < 0 ? clipped * 32768 : clipped * 32767;
            }
            const bytes = new Uint8Array(pcm.buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
            socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: btoa(binary) }));
          };
          source.connect(processor);
          processor.connect(mutedGain);
          mutedGain.connect(context.destination);
          void speakInstantFemale(WELCOME_PHRASE);
        } else if (message.message_type === 'partial_transcript') {
          if (message.text) setLiveTranscript(message.text);
        } else if (message.message_type === 'committed_transcript') {
          if (message.text) handleTranscript(message.text);
        } else if (message.message_type === 'error' || message.message_type === 'rate_limited') {
          console.error('Scribe transcription error:', message);
          setStatusText('Live listening encountered a problem. Check the account and connection.');
          socket.close();
        }
      };
      socket.onerror = () => setStatusText('Live listening connection failed. Check your internet and ElevenLabs setup.');
      socket.onclose = () => {
        if (shouldListenRef.current) {
          setStatusText('Switching to browser speech recognition');
          stopListeningResources();
          shouldListenRef.current = true;
          startBrowserRecognition();
        }
      };
    } catch (error) {
      console.warn('ElevenLabs realtime listening unavailable; using browser fallback.', error);
      stopListeningResources();
      shouldListenRef.current = true;
      startBrowserRecognition();
    }
  }, [handleTranscript, speakInstantFemale, startBrowserRecognition]);

  const stopListeningResources = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    mutedGainRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current = null;
    mutedGainRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') void audioContextRef.current.close();
    audioContextRef.current = null;
    recognitionRef.current?.abort?.();
    recognitionRef.current = null;
    isRecognizingRef.current = false;
    socketRef.current?.close();
    socketRef.current = null;
    setIsListening(false);
  }, []);

  useEffect(() => () => {
    shouldListenRef.current = false;
    stopListeningResources();
    audioRef.current?.pause();
    if (speechResumeTimerRef.current) clearInterval(speechResumeTimerRef.current);
  }, [stopListeningResources]);

  const handleCentralSpeakerClick = () => {
    if (isListening) {
      shouldListenRef.current = false;
      stopListeningResources();
      setStatusText('Assistant paused');
      phaseRef.current = 'sleeping';
      return;
    }
    setIsListening(true);
    void startRealtimeListening();
  };

  const importGuestCsv = useCallback((file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv') && !file.type.includes('csv')) {
      setStatusText('Please choose a CSV file for the guest list.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      try {
        const response = await fetch('/api/invitations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csvContent: content }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not import that guest list');
        await refreshAttendance();
        setStatusText(`Guest list loaded: ${result.count} people`);
        speakInstantFemale(`Guest list updated with ${result.count} attendees.`);
      } catch (error) {
        console.error(error);
        setStatusText('Guest list upload failed');
        speakInstantFemale('I could not load that guest list. Please check the CSV file and try again.');
      }
    };
    reader.readAsText(file);
  }, [refreshAttendance, speakInstantFemale]);

  // Keep drag-and-drop guest list import, and save the new list through the backend.
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) importGuestCsv(file);
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [importGuestCsv]);

  return (
    <div className="relative w-screen h-screen min-h-screen bg-[#ECECE9] text-neutral-900 font-sans antialiased overflow-hidden select-none flex items-center justify-center">
      {/* Centralized Animated Head with Smooth Continuous Left-to-Right and Right-to-Left Turn */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden"
        animate={{
          x: mousePos.x * 12 + (isSpeaking ? Math.sin(Date.now() / 150) * 2 : 0),
          y: mousePos.y * 8 + (isSpeaking ? Math.cos(Date.now() / 150) * 2.5 : 0),
          rotateY: mousePos.x * 5,
          rotateX: -mousePos.y * 5,
          scale: isInspecting ? 1.25 : 1.05,
        }}
        transition={{
          type: 'spring',
          damping: isInspecting ? 20 : 26,
          stiffness: isInspecting ? 95 : 140,
          mass: 0.8,
        }}
        style={{
          perspective: 1200,
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Seamless Continuous Head Turning Video (1080p FastStart with multi-tier fallbacks) */}
        <video
          ref={videoRef}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          onError={(e) => {
            const target = e.currentTarget;
            if (target.src.includes('1080p')) {
              target.src = SEAMLESS_VIDEO_URL;
            } else if (!target.src.includes('cloudfront')) {
              target.src = FALLBACK_VIDEO_URL;
            }
          }}
          className="w-full h-full object-cover object-center"
        >
          <source src={OPTIMIZED_VIDEO_URL} type="video/mp4" />
          <source src={SEAMLESS_VIDEO_URL} type="video/mp4" />
        </video>

        {/* Ethereal speaking aura */}
        {isSpeaking && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{
              opacity: [0.15, 0.35, 0.15],
              scale: [0.95, 1.08, 0.95],
            }}
            transition={{
              repeat: Infinity,
              duration: 2.2,
              ease: 'easeInOut',
            }}
            className="absolute w-[500px] h-[500px] rounded-full bg-radial from-neutral-300/40 via-neutral-200/20 to-transparent blur-3xl pointer-events-none"
          />
        )}
      </motion.div>

      {/* Subtle depth vignette */}
      <div
        className="absolute inset-0 pointer-events-none bg-radial from-transparent via-transparent to-neutral-900/10"
        aria-hidden="true"
      />

      {/* "Vinicunca" Purely on the Side */}
      <aside className="absolute left-6 sm:left-10 md:left-14 lg:left-16 top-1/2 -translate-y-1/2 z-20 pointer-events-none flex flex-col items-start select-none">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="text-5xl sm:text-7xl md:text-8xl lg:text-[104px] font-light tracking-[-0.04em] text-neutral-900 leading-[0.88] uppercase">
            Vini<br className="hidden sm:inline" />cunca
          </h1>
        </motion.div>
      </aside>

      {/* Central Speaker Button (Clean, Only Control) */}
      <div className="fixed bottom-10 sm:bottom-12 inset-x-0 flex flex-col items-center justify-center z-30 pointer-events-auto">
        <div className="mb-5 max-w-[min(92vw,560px)] rounded-2xl border border-white/50 bg-white/75 px-5 py-3 text-center shadow-lg shadow-black/5 backdrop-blur-xl">
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-neutral-800">
            <span className={`h-2 w-2 rounded-full ${isListening ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'}`} />
            <span>{statusText}</span>
          </div>
          {liveTranscript && isListening && <p className="mt-1 max-w-full truncate text-xs text-neutral-600" aria-live="polite">Heard: {liveTranscript}</p>}
          <div className="mt-2 flex items-center justify-center gap-3 text-[11px] tracking-wide text-neutral-500">
            <span>{checkedInCount} / {guestCount} checked in</span>
            {isListening && !isAwake && <span>Say &quot;Hey Vini&quot; or &quot;Hey Vinicunca&quot;</span>}
            <label className="cursor-pointer underline underline-offset-2 hover:text-neutral-800">
              Load guest CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importGuestCsv(file);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
        <div className="relative flex items-center justify-center">
          {/* Animated acoustic soundwave rings when speaking */}
          {isSpeaking && (
            <>
              <motion.div
                initial={{ scale: 0.9, opacity: 0.6 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ repeat: Infinity, duration: 1.8, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full border border-neutral-900/40 pointer-events-none"
              />
              <motion.div
                initial={{ scale: 0.9, opacity: 0.4 }}
                animate={{ scale: 2.1, opacity: 0 }}
                transition={{ repeat: Infinity, duration: 1.8, delay: 0.6, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full border border-neutral-900/20 pointer-events-none"
              />
            </>
          )}

          {/* Central Speaker Button */}
          <motion.button
            type="button"
            onClick={handleCentralSpeakerClick}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            className={`relative w-16 h-16 sm:w-18 sm:h-18 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl cursor-pointer ${
              isSpeaking
                ? 'bg-neutral-900 text-white shadow-neutral-950/20'
                : 'bg-white/85 hover:bg-white text-neutral-900 backdrop-blur-xl border border-neutral-200/80 shadow-black/10'
            }`}
            aria-label={isListening ? 'Pause Vinicunca assistant' : 'Start Vinicunca assistant'}
            title={isListening ? 'Pause the assistant' : 'Start the assistant and greet the next guest'}
          >
            <Volume2 className="w-7 h-7 sm:w-8 sm:h-8 stroke-[1.8]" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
