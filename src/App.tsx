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
  name: string;
  tier: string;
  table: string;
}

const DEFAULT_GUESTS: GuestRecord[] = [
  { name: 'Wilfred Owubokiri', tier: 'Founding Dignitary', table: 'Sanctuary 01' },
  { name: 'Elena Rostova', tier: 'Architectural Delegate', table: 'Sanctuary 02' },
  { name: 'Julian Croft', tier: 'Patron of the Arts', table: 'Sanctuary 03' },
  { name: 'Dr. Maya Lin', tier: 'Scientific Fellow', table: 'Sanctuary 01' },
  { name: 'Marcus Vance', tier: 'Executive Envoy', table: 'Sanctuary 04' },
  { name: 'Aria Sterling', tier: 'Special Envoy', table: 'Sanctuary 02' },
  { name: 'David Kim', tier: 'Design Partner', table: 'Sanctuary 03' },
  { name: 'Sophia Al-Mansoor', tier: 'Cultural Ambassador', table: 'Sanctuary 01' },
  { name: 'Liam O\'Connor', tier: 'Guest of Honor', table: 'Sanctuary 04' },
  { name: 'Camila Santos', tier: 'Curator', table: 'Sanctuary 02' },
];

function parseCSV(text: string): GuestRecord[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const nameIdx = headers.indexOf('name') !== -1 ? headers.indexOf('name') : 0;
  const tierIdx = headers.indexOf('tier') !== -1 ? headers.indexOf('tier') : 1;
  const tableIdx = headers.indexOf('table') !== -1 ? headers.indexOf('table') : 2;

  const records: GuestRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    if (!row.trim()) continue;

    const values: string[] = [];
    let insideQuotes = false;
    let currentVal = '';
    for (const char of row) {
      if (char === '"') {
        insideQuotes = !insideQuotes;
      } else if (char === ',' && !insideQuotes) {
        values.push(currentVal.trim());
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    values.push(currentVal.trim());

    if (values[nameIdx]) {
      records.push({
        name: values[nameIdx],
        tier: values[tierIdx] || 'Invited Guest',
        table: values[tableIdx] || 'Main Pavilion',
      });
    }
  }
  return records;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Parallax tracking
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // State
  const [isAwake, setIsAwake] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);

  // Synchronous state refs to avoid effect race conditions
  const isAwakeRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isInspectingRef = useRef(false);

  // In-memory guest registry
  const guestListRef = useRef<GuestRecord[]>(DEFAULT_GUESTS);

  // Recognition and Speech refs
  const recognitionRef = useRef<any>(null);
  const isRecognizingRef = useRef(false);
  const shouldListenRef = useRef(true);
  const cachedFemaleVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const speechResumeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Load server CSV silently on mount
  useEffect(() => {
    fetch('/api/invitations')
      .then((res) => {
        if (!res.ok) throw new Error('Fetch failed');
        return res.json();
      })
      .then((data) => {
        if (data.guests && Array.isArray(data.guests) && data.guests.length > 0) {
          guestListRef.current = data.guests;
        }
      })
      .catch(() => {
        // Safe silent fallback to DEFAULT_GUESTS
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

  // Fast, reliable, error-handled speech synthesis
  const speakInstantFemale = useCallback((text: string, onDone?: () => void) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onDone) onDone();
      return;
    }

    try {
      // Clear previous utterance
      window.speechSynthesis.cancel();
      setIsSpeaking(true);
      isSpeakingRef.current = true;

      // Chrome speech resume bug safeguard
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.06;
      utterance.volume = 1.0;

      if (cachedFemaleVoiceRef.current) {
        utterance.voice = cachedFemaleVoiceRef.current;
      }

      utterance.onend = () => {
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        if (onDone) onDone();
      };

      utterance.onerror = (e) => {
        // Ignore canceled speech error events
        if (e.error !== 'canceled') {
          console.warn('SpeechSynthesis error:', e.error);
        }
        setIsSpeaking(false);
        isSpeakingRef.current = false;
        if (onDone) onDone();
      };

      window.speechSynthesis.speak(utterance);

      // Keep speech synthesis active on longer phrases (Chrome bug workaround)
      if (speechResumeTimerRef.current) clearInterval(speechResumeTimerRef.current);
      speechResumeTimerRef.current = setInterval(() => {
        if (!window.speechSynthesis.speaking) {
          if (speechResumeTimerRef.current) clearInterval(speechResumeTimerRef.current);
        } else if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }, 3000);
    } catch (err) {
      console.warn('Speech invocation failed:', err);
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      if (onDone) onDone();
    }
  }, []);

  // Sub-millisecond instant fuzzy search in CSV list
  const findGuestInstant = useCallback((query: string): GuestRecord | null => {
    if (!query) return null;
    const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (!q) return null;

    const list = guestListRef.current;

    // 1. Direct equality
    const direct = list.find(
      (g) => g.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim() === q
    );
    if (direct) return direct;

    // 2. Substring matching
    const substr = list.find((g) => {
      const gn = g.name.toLowerCase();
      return gn.includes(q) || q.includes(gn);
    });
    if (substr) return substr;

    // 3. Word token matching
    const qTokens = q.split(/\s+/).filter((t) => t.length > 2);
    for (const guest of list) {
      const gTokens = guest.name.toLowerCase().split(/\s+/);
      for (const qt of qTokens) {
        if (gTokens.some((gt) => gt.includes(qt) || qt.includes(gt))) {
          return guest;
        }
      }
    }

    return null;
  }, []);

  // Process attendee name with zero delay
  const processGuestName = useCallback(
    (rawTranscript: string) => {
      const cleanName = rawTranscript
        .replace(/my name is/i, '')
        .replace(/i am/i, '')
        .replace(/this is/i, '')
        .replace(/hey vinicunca/i, '')
        .replace(/vinicunca/i, '')
        .trim();

      if (!cleanName || cleanName.length < 2) return;

      setIsInspecting(true);
      isInspectingRef.current = true;

      const matched = findGuestInstant(cleanName);

      let reply = '';
      if (matched) {
        reply = `Looking at you closely. Welcome to the Vinicunca, ${matched.name}. Your invitation is confirmed. Access is granted to ${matched.table}.`;
      } else {
        reply = `Looking at you closely. I have checked our invitation sheet for ${cleanName}, but do not see a confirmed reservation. Please check with reception.`;
      }

      speakInstantFemale(reply, () => {
        setIsInspecting(false);
        isInspectingRef.current = false;
      });
    },
    [findGuestInstant, speakInstantFemale]
  );

  // Wake up handler
  const handleWakeUp = useCallback(() => {
    setIsAwake(true);
    isAwakeRef.current = true;
    speakInstantFemale(WELCOME_PHRASE);
  }, [speakInstantFemale]);

  // Robust, single-lifecycle SpeechRecognition engine (eliminates DOMException & invalid state errors)
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    let recognition: any = null;
    shouldListenRef.current = true;

    try {
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        isRecognizingRef.current = true;
      };

      recognition.onresult = (event: any) => {
        // Ignore recognized speech if AI is currently speaking its own response
        if (isSpeakingRef.current) return;

        const lastResultIndex = event.results.length - 1;
        const transcript = (event.results[lastResultIndex][0]?.transcript || '').trim();
        const lower = transcript.toLowerCase();

        // 1. Wake word command: "Hey Vinicunca"
        if (lower.includes('vinicunca') || lower.includes('hey vinicunca')) {
          handleWakeUp();
          return;
        }

        // 2. Name checking when awake
        if (isAwakeRef.current && transcript.length > 1) {
          processGuestName(transcript);
        }
      };

      recognition.onerror = (event: any) => {
        isRecognizingRef.current = false;
        // Suppress expected transient events (not-allowed before click, no-speech timeout, aborted)
        if (
          event.error !== 'no-speech' &&
          event.error !== 'aborted' &&
          event.error !== 'not-allowed'
        ) {
          console.warn('SpeechRecognition warning:', event.error);
        }
      };

      recognition.onend = () => {
        isRecognizingRef.current = false;
        // Auto-restart safely with delay if still mounted
        if (shouldListenRef.current && !isRecognizingRef.current) {
          setTimeout(() => {
            if (shouldListenRef.current && !isRecognizingRef.current && recognition) {
              try {
                recognition.start();
              } catch {
                // Ignore if browser is not ready
              }
            }
          }, 400);
        }
      };

      recognitionRef.current = recognition;

      // Attempt start safely
      try {
        recognition.start();
      } catch {
        // Browser requires user gesture first, handled on button click
      }
    } catch {
      // Speech recognition not supported or denied
    }

    return () => {
      shouldListenRef.current = false;
      if (recognition) {
        try {
          recognition.abort();
        } catch {}
      }
      if (speechResumeTimerRef.current) {
        clearInterval(speechResumeTimerRef.current);
      }
    };
  }, [handleWakeUp, processGuestName]);

  // Central Speaker Button handler
  const handleCentralSpeakerClick = () => {
    // Ensure speech synthesis and audio context are resumed on click
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }

    // Try starting recognition on user gesture if not already active
    if (recognitionRef.current && !isRecognizingRef.current) {
      try {
        recognitionRef.current.start();
      } catch {}
    }

    if (isSpeaking) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
      isSpeakingRef.current = false;
      return;
    }

    handleWakeUp();
  };

  // Drag-and-drop CSV upload onto window (completely invisible in UI, zero clutter)
  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file && (file.name.endsWith('.csv') || file.type.includes('csv'))) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          if (content) {
            const parsed = parseCSV(content);
            if (parsed.length > 0) {
              guestListRef.current = parsed;
              speakInstantFemale(`Invitation sheet updated with ${parsed.length} guests.`);
            }
          }
        };
        reader.readAsText(file);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [speakInstantFemale]);

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
            aria-label={isSpeaking ? 'Mute Vinicunca' : 'Wake Vinicunca'}
            title="Click to speak with Vinicunca (or say 'Hey Vinicunca')"
          >
            <Volume2 className="w-7 h-7 sm:w-8 sm:h-8 stroke-[1.8]" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
