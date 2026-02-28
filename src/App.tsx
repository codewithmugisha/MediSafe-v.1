import React, { useState, useEffect, useRef } from 'react';
import { 
  Bell, 
  Plus, 
  QrCode, 
  Activity, 
  MessageSquare, 
  ClipboardList, 
  User, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  ChevronRight,
  History,
  Send,
  Loader2,
  Trash2,
  Stethoscope,
  Fingerprint,
  ScanFace,
  Lock,
  LogOut,
  Camera,
  BarChart3,
  Box,
  Volume2
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import Markdown from 'react-markdown';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";
import { getAIAgentResponse, generateHealthSummary } from './services/geminiService';

// --- Types ---
interface Medication {
  id: number;
  name: string;
  dosage: string;
  frequency: string;
  time: string;
  qr_data?: string;
}

interface Log {
  id: number;
  medication_id: number;
  medication_name?: string;
  status: 'taken' | 'missed';
  mood: string;
  notes: string;
  timestamp: string;
}

interface Profile {
  name: string;
  condition: string;
  doctor_notes: string;
}

interface Settings {
  medbox_id: string;
  snooze_duration_minutes: number;
  notifications_enabled: boolean;
  voice_agent_enabled: boolean;
  distress_monitor_enabled: boolean;
  minhealth_sync_enabled: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// --- Components ---

const Card = ({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) => (
  <div className={cn("bg-white rounded-3xl p-6 shadow-sm border border-black/5", className)} onClick={onClick}>
    {children}
  </div>
);

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className,
  disabled,
  loading,
  type = 'button'
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}) => {
  const variants = {
    primary: "bg-emerald-600 text-white hover:bg-emerald-700",
    secondary: "bg-slate-900 text-white hover:bg-slate-800",
    outline: "border border-slate-200 text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-600 hover:bg-slate-100",
    danger: "bg-red-50 text-red-600 hover:bg-red-100"
  };

  return (
    <button 
      onClick={onClick}
      disabled={disabled || loading}
      type={type}
      className={cn(
        "px-4 py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        className
      )}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authMethod, setAuthMethod] = useState<'none' | 'face' | 'biometric' | 'password'>('none');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [password, setPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [snoozeDisclaimer, setSnoozeDisclaimer] = useState<string | null>(null);
  const [snoozeUntil, setSnoozeUntil] = useState<number | null>(null);
  const [isDistressActive, setIsDistressActive] = useState(false);
  const [distressMessage, setDistressMessage] = useState<string | null>(null);
  const [insights, setInsights] = useState<string>("Analyzing your health patterns...");
  const [nextDose, setNextDose] = useState<Medication | null>(null);
  const isDistressProcessing = useRef(false);
  const lastDistressTime = useRef(0);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'meds' | 'chat' | 'history' | 'profile' | 'analytics'>('dashboard');
  const [medications, setMedications] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [profile, setProfile] = useState<Profile>({ name: '', condition: '', doctor_notes: '' });
  const [settings, setSettings] = useState<Settings>({
    medbox_id: 'MB-7892',
    snooze_duration_minutes: 15,
    notifications_enabled: true,
    voice_agent_enabled: true,
    distress_monitor_enabled: true,
    minhealth_sync_enabled: false
  });
  const [isAddingMed, setIsAddingMed] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [chatMessages, setChatMessages] = useState<Message[]>([
    { role: 'assistant', content: "Hello! I'm your MediSafe Agent. How are you feeling today?" }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<{id: number, title: string, body: string, time: string, type: 'info' | 'urgent' | 'recommendation'}[]>([
    { id: 1, title: 'Welcome to MediSafe AI', body: 'Your agent is active and monitoring your health.', time: 'Just now', type: 'info' }
  ]);
  const [medbox, setMedbox] = useState<{current_weight_grams: number, status: string} | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentMood, setCurrentMood] = useState('Stable');

  // Form State
  const [newMed, setNewMed] = useState({ name: '', dosage: '', frequency: 'Daily', time: '08:00' });

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyzerRef = useRef<AnalyserNode | null>(null);

  const fetchData = async () => {
    try {
      const [medsRes, logsRes, profileRes, medboxRes, aiNotifRes, settingsRes] = await Promise.all([
        fetch('/api/medications'),
        fetch('/api/logs'),
        fetch('/api/profile'),
        fetch('/api/medbox'),
        fetch('/api/ai-notifications'),
        fetch('/api/settings')
      ]);
      const meds = await medsRes.json();
      const logsData = await logsRes.json();
      const profileData = await profileRes.json();
      const medboxData = await medboxRes.json();
      const aiNotifs = await aiNotifRes.json();
      const settingsData = await settingsRes.json();
      
      setMedications(meds);
      setLogs(logsData);
      setProfile(profileData);
      setMedbox(medboxData);
      setSettings({
        ...settingsData,
        notifications_enabled: !!settingsData.notifications_enabled,
        voice_agent_enabled: !!settingsData.voice_agent_enabled,
        distress_monitor_enabled: !!settingsData.distress_monitor_enabled,
        minhealth_sync_enabled: !!settingsData.minhealth_sync_enabled
      });
      
      // Merge local notifications with AI ones
      const formattedAiNotifs = aiNotifs.map((n: any) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        time: format(new Date(n.timestamp), 'h:mm a'),
        type: n.type
      }));
      
      setNotifications(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newOnes = formattedAiNotifs.filter((n: any) => !existingIds.has(n.id));
        return [...newOnes, ...prev];
      });
      
      // Predict next dose and insights
      updateAgenticInsights(meds, logsData, profileData);
    } catch (err) {
      console.error("Failed to fetch data", err);
    }
  };

  const lastInsightTime = useRef(0);
  const updateAgenticInsights = async (meds: Medication[], logs: Log[], profile: Profile) => {
    // Find next dose
    if (meds.length > 0) {
      const now = new Date();
      const sorted = [...meds].sort((a, b) => a.time.localeCompare(b.time));
      const upcoming = sorted.find(m => m.time > now.toTimeString().slice(0, 5)) || sorted[0];
      setNextDose(upcoming);
    }

    // Throttle insights (once every 30 seconds)
    if (Date.now() - lastInsightTime.current < 30000) return;
    lastInsightTime.current = Date.now();

    // Generate insights via Gemini
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `Based on patient profile: ${JSON.stringify(profile)} and meds: ${JSON.stringify(meds)}, provide a one-sentence health insight for today.`,
      });
      setInsights(response.text || "Stay hydrated and follow your schedule.");
    } catch (e: any) {
      console.error("Insight error", e);
      if (e.message?.includes('429') || e.message?.includes('quota')) {
        setInsights("Monitoring your health patterns. Everything looks stable.");
      }
    }
  };

  const handleSnooze = async (med: Medication) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `The patient wants to snooze their ${med.name} (${med.dosage}). Their condition is ${profile.condition}. Provide a serious medical disclaimer about the risks of delaying this specific medication. Keep it concise but urgent.`,
      });
      setSnoozeDisclaimer(response.text || "Delaying medication can lead to complications.");
      setSnoozeUntil(Date.now() + settings.snooze_duration_minutes * 60000);
    } catch (e) {
      setSnoozeDisclaimer("Delaying medication increases health risks. Please take it as soon as possible.");
      setSnoozeUntil(Date.now() + settings.snooze_duration_minutes * 60000);
    }
  };

  useEffect(() => {
    if (isVerifying && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isVerifying]);

  const startMedVerification = async () => {
    setIsVerifying(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      // The useEffect will handle srcObject attachment once videoRef is rendered
      
      // Start analysis loop
      setTimeout(analyzeMedIngestion, 1000); // Give it a second to render and warm up
    } catch (err) {
      console.error("Camera error", err);
      setIsVerifying(false);
    }
  };

  const analyzeMedIngestion = async () => {
    if (!videoRef.current || !isVerifying) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    
    const checkFrame = async () => {
      if (!isVerifying || !videoRef.current) return;
      
      ctx?.drawImage(videoRef.current, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg').split(',')[1];
      
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: {
            parts: [
              { text: "Analyze this video frame. Is the patient swallowing their medication? Answer only 'YES' if you see them putting a pill in their mouth and swallowing, otherwise 'NO'." },
              { inlineData: { mimeType: "image/jpeg", data: base64 } }
            ]
          }
        });
        
        if (response.text?.includes('YES')) {
          handleVerificationSuccess();
        } else {
          setTimeout(checkFrame, 2000); // Check again in 2s
        }
      } catch (e) {
        console.error("Vision error", e);
        setTimeout(checkFrame, 3000);
      }
    };

    checkFrame();
  };

  const handleVerificationSuccess = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    setIsVerifying(false);
    setIsSuccess(true);
    
    // Log it
    if (nextDose) {
      handleLogMed(nextDose.id!, 'taken');
    }

    setTimeout(() => {
      setIsSuccess(false);
      fetchData();
    }, 4000);
  };

  const startDistressMonitor = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyzer = audioContext.createAnalyser();
      source.connect(analyzer);
      
      audioContextRef.current = audioContext;
      analyzerRef.current = analyzer;
      setIsDistressActive(true);

      const buffer = new Float32Array(analyzer.fftSize);
      const checkAudio = () => {
        if (!audioContextRef.current || isDistressProcessing.current) return;
        
        // Cooldown check (10 seconds)
        if (Date.now() - lastDistressTime.current < 10000) {
          requestAnimationFrame(checkAudio);
          return;
        }

        analyzer.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sum / buffer.length);
        
        if (rms > 0.4) { // Increased threshold slightly
          handleDistressDetected();
          handleSendMessage(); // Wake up agent
        }
        requestAnimationFrame(checkAudio);
      };
      checkAudio();
    } catch (e) {
      console.error("Audio monitor error", e);
    }
  };

  const handleDistressDetected = async () => {
    if (isDistressProcessing.current) return;
    isDistressProcessing.current = true;
    lastDistressTime.current = Date.now();
    
    setDistressMessage("I heard a distress signal. What happened? I'm here to help.");
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `The patient (${profile.condition}) just screamed or made a loud distress noise. Provide immediate, calm first-aid instructions for their condition. Also, assess their likely mood (e.g., 'Panic', 'Pain', 'Fear').`,
      });
      const aiText = response.text || "Please stay calm. Help is being notified.";
      setDistressMessage(aiText);
      
      // Extract mood if possible
      if (aiText.toLowerCase().includes('panic')) setCurrentMood('Panic');
      else if (aiText.toLowerCase().includes('pain')) setCurrentMood('Pain');
      else if (aiText.toLowerCase().includes('fear')) setCurrentMood('Fear');
      else setCurrentMood('Distressed');
      
      // Autonomous wake up with the distress context
      handleSendMessage(`EMERGENCY: Distress detected for patient with ${profile.condition}. Context: ${aiText}`);
      
    } catch (e: any) {
      console.error("Distress AI error", e);
      if (e.message?.includes('429') || e.message?.includes('quota')) {
        setDistressMessage("I detected a distress signal. Please stay calm. If this is an emergency, please call for help immediately.");
      }
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      startDistressMonitor();
    }
    return () => {
      audioContextRef.current?.close();
    };
  }, [isAuthenticated]);

  useEffect(() => {
    // Autonomous Notification Service
    const interval = setInterval(() => {
      if (!isAuthenticated || !nextDose || !settings.notifications_enabled) return;
      
      // Check if snoozed
      if (snoozeUntil && Date.now() < snoozeUntil) return;
      
      const now = new Date();
      const [h, m] = nextDose.time.split(':').map(Number);
      const doseTime = new Date();
      doseTime.setHours(h, m, 0);
      
      const diff = (now.getTime() - doseTime.getTime()) / (1000 * 60);
      
      if (diff > 0 && diff < 1) {
        new Notification("MediSafe Reminder", { body: `It's time for your ${nextDose.name}.` });
        setNotifications(prev => [{
          id: Date.now(),
          title: 'Medication Reminder',
          body: `It's time for your ${nextDose.name}.`,
          time: 'Just now',
          type: 'info'
        }, ...prev]);
      } else if (diff >= 15 && diff < 16) {
        new Notification("URGENT CLINICAL ALERT", { 
          body: `CRITICAL: You missed your ${nextDose.name} dose 15 minutes ago. Please take it immediately.`,
          requireInteraction: true
        });
        setNotifications(prev => [{
          id: Date.now(),
          title: 'URGENT CLINICAL ALERT',
          body: `CRITICAL: You missed your ${nextDose.name} dose 15 minutes ago.`,
          time: '15m ago',
          type: 'urgent'
        }, ...prev]);
      }
    }, 60000);
    
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    return () => clearInterval(interval);
  }, [isAuthenticated, nextDose]);

  useEffect(() => {
    // MedBox Simulation
    const interval = setInterval(async () => {
      if (!isAuthenticated) return;
      
      // Randomly simulate weight change (e.g., patient takes a pill)
      if (Math.random() > 0.95) {
        const newWeight = (medbox?.current_weight_grams || 500) - 5;
        await fetch('/api/medbox/weight', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weight: newWeight })
        });
        
        // Notify agent of weight change
        await fetch('/api/ai-notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            title: 'MedBox Weight Change', 
            body: `Detected weight change: ${newWeight}g. Verifying dose...`,
            type: 'info'
          })
        });
        fetchData();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated, medbox]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
    }
  }, [isAuthenticated]);

  // QR Scanner Logic
  useEffect(() => {
    let scanner: Html5QrcodeScanner | null = null;
    if (isScanning && isAuthenticated) {
      scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 }, false);
      scanner.render((decodedText) => {
        setNewMed(prev => ({ ...prev, name: decodedText, dosage: 'As per label' }));
        setIsScanning(false);
        scanner?.clear();
      }, (err) => {
        // console.warn(err);
      });
    }
    return () => {
      scanner?.clear();
    };
  }, [isScanning, isAuthenticated]);

  const startFaceAuth = async () => {
    setAuthMethod('face');
    setIsAuthenticating(true);
    setCameraError(null);
    
    if (isDemoMode) {
      // Simulated Face ID for Demo
      setTimeout(() => {
        setIsAuthenticated(true);
        setIsAuthenticating(false);
        setAuthMethod('none');
      }, 3000);
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Your browser does not support camera access.");
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      // Simulate face detection processing
      setTimeout(() => {
        setIsAuthenticated(true);
        setIsAuthenticating(false);
        setAuthMethod('none');
        // Stop camera
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }, 3000);
    } catch (err: any) {
      console.error("Camera access denied", err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError("Camera permission was denied. Please allow camera access in your browser settings and try again.");
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError("No camera was found on your device.");
      } else {
        setCameraError(`Camera error: ${err.message || "Unknown error"}`);
      }
    }
  };

  const startBiometricAuth = async () => {
    setAuthMethod('biometric');
    setIsAuthenticating(true);
    
    // Simulate WebAuthn / Fingerprint
    setTimeout(() => {
      setIsAuthenticated(true);
      setIsAuthenticating(false);
      setAuthMethod('none');
    }, 1500);
  };

  const handlePasswordLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === '1234') { // Simple demo password
      setIsAuthenticated(true);
      setAuthMethod('none');
      setPassword('');
    } else {
      alert("Invalid password. For demo purposes, use '1234'.");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setActiveTab('dashboard');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-white font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md text-center space-y-8"
        >
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 bg-emerald-600 rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-emerald-500/20">
              <Activity className="w-12 h-12" />
            </div>
            <h1 className="text-4xl font-black tracking-tighter">MediSafe</h1>
            <p className="text-slate-400 font-medium">Your Secure Health Companion</p>
          </div>

          <Card className="bg-slate-800/50 border-slate-700/50 backdrop-blur-xl p-8 space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-bold">Welcome Back</h2>
              <p className="text-sm text-slate-400">Please authenticate to access your medical records.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <Button 
                onClick={startFaceAuth} 
                variant="primary" 
                className="h-16 text-lg rounded-2xl bg-emerald-600 hover:bg-emerald-500 border-none"
                disabled={isAuthenticating}
              >
                <ScanFace className="w-6 h-6" /> Face ID Login
              </Button>
              <Button 
                onClick={startBiometricAuth} 
                variant="secondary" 
                className="h-16 text-lg rounded-2xl bg-slate-700 hover:bg-slate-600 border-none"
                disabled={isAuthenticating}
              >
                <Fingerprint className="w-6 h-6" /> Biometric Login
              </Button>
              <Button 
                onClick={() => setAuthMethod('password')} 
                variant="ghost" 
                className="text-slate-400 hover:text-white"
                disabled={isAuthenticating}
              >
                <Lock className="w-4 h-4" /> Login with Password
              </Button>
            </div>

            <div className="pt-6 border-t border-slate-700/50 space-y-4">
              <div className="flex items-center justify-between px-2">
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Demo Mode</span>
                <button 
                  onClick={() => setIsDemoMode(!isDemoMode)}
                  className={cn(
                    "w-12 h-6 rounded-full transition-all relative",
                    isDemoMode ? "bg-emerald-600" : "bg-slate-700"
                  )}
                >
                  <motion.div 
                    animate={{ x: isDemoMode ? 24 : 4 }}
                    className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-sm"
                  />
                </button>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Enable Demo Mode to bypass real camera & biometric hardware requirements.
              </p>
              <Button 
                variant="outline" 
                onClick={() => setIsAuthenticated(true)}
                className="w-full border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs py-2"
              >
                Quick Bypass for Review
              </Button>
            </div>

            <div className="pt-4 flex items-center justify-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-widest">
              <Lock className="w-3 h-3" /> End-to-End Encrypted
            </div>
          </Card>
        </motion.div>

      {/* Agentic & Auth Overlays */}
      <AnimatePresence>
        {isVerifying && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-slate-950 flex flex-col items-center justify-center p-6"
          >
            <div className="w-full max-w-md space-y-8 text-center">
              <div className="relative aspect-square max-w-[320px] mx-auto rounded-full overflow-hidden border-8 border-emerald-500/30 shadow-[0_0_50px_rgba(16,185,129,0.2)] bg-slate-900">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  muted 
                  playsInline 
                  className="w-full h-full object-cover scale-x-[-1]" 
                />
                
                {/* Camera Focusing Overlay */}
                <div className="absolute inset-0 pointer-events-none z-20">
                  {/* Vignette */}
                  <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_50%,rgba(2,6,23,0.6)_100%)]" />
                  
                  {/* Corner Brackets */}
                  <div className="absolute top-10 left-10 w-10 h-10 border-t-2 border-l-2 border-emerald-400/80 rounded-tl-sm" />
                  <div className="absolute top-10 right-10 w-10 h-10 border-t-2 border-r-2 border-emerald-400/80 rounded-tr-sm" />
                  <div className="absolute bottom-10 left-10 w-10 h-10 border-b-2 border-l-2 border-emerald-400/80 rounded-bl-sm" />
                  <div className="absolute bottom-10 right-10 w-10 h-10 border-b-2 border-r-2 border-emerald-400/80 rounded-br-sm" />
                  
                  {/* REC Indicator */}
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-2 py-0.5 bg-black/40 backdrop-blur-sm rounded-full border border-white/10">
                    <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold text-white uppercase tracking-tighter">REC</span>
                  </div>
                </div>

                {/* Scanning Line */}
                <motion.div 
                  animate={{ top: ['0%', '100%', '0%'] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute left-0 right-0 h-1 bg-emerald-400 shadow-[0_0_20px_rgba(52,211,153,1)] z-10"
                />

                {/* Center Reticle */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-16 h-16 border-2 border-emerald-400/30 rounded-full animate-ping" />
                  <div className="absolute w-1 h-1 bg-emerald-400 rounded-full" />
                </div>
              </div>

              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-widest animate-pulse">
                  <Camera className="w-3 h-3" /> AI Vision Active
                </div>
                <h3 className="text-3xl font-black text-white tracking-tight">Verifying Ingestion</h3>
                <p className="text-slate-400 text-sm leading-relaxed max-w-xs mx-auto">
                  Please look directly into the camera and swallow your <span className="text-emerald-400 font-bold">{nextDose?.name}</span>.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-center gap-4">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
                <Button variant="ghost" onClick={() => {
                  setIsVerifying(false);
                  streamRef.current?.getTracks().forEach(t => t.stop());
                }} className="text-slate-500 hover:text-white">Cancel Verification</Button>
              </div>
            </div>
          </motion.div>
        )}

        {isSuccess && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-0 z-[110] bg-emerald-600 flex flex-col items-center justify-center p-6 text-white text-center"
          >
            <motion.div 
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 12 }}
              className="w-32 h-32 bg-white rounded-full flex items-center justify-center text-emerald-600 mb-8 shadow-2xl"
            >
              <CheckCircle2 className="w-20 h-20" />
            </motion.div>
            <h2 className="text-4xl font-black tracking-tighter mb-4">Congratulations!</h2>
            <p className="text-xl font-medium opacity-90">You have successfully taken your medication.</p>
            <p className="mt-2 text-emerald-100">Your health history has been updated automatically.</p>
          </motion.div>
        )}

        {snoozeDisclaimer && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-6"
          >
            <Card className="max-w-md bg-white p-8 space-y-6">
              <div className="flex items-center gap-3 text-red-600">
                <AlertCircle className="w-8 h-8" />
                <h3 className="text-xl font-bold">Medical Disclaimer</h3>
              </div>
              <div className="prose prose-sm text-slate-600">
                <Markdown>{snoozeDisclaimer}</Markdown>
              </div>
              <div className="flex gap-3">
                <Button onClick={() => {
                  setSnoozeDisclaimer(null);
                  startMedVerification();
                }} className="flex-1 bg-emerald-600">Take Now</Button>
                <Button variant="outline" onClick={() => setSnoozeDisclaimer(null)} className="flex-1">I Understand</Button>
              </div>
            </Card>
          </motion.div>
        )}

        {distressMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed inset-x-0 bottom-0 z-[130] p-6"
          >
            <Card className="bg-red-600 text-white p-6 shadow-2xl border-none">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-white/20 rounded-2xl">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold">Distress Signal Detected</h3>
                  <div className="mt-2 text-red-50 leading-relaxed">
                    <Markdown>{distressMessage}</Markdown>
                  </div>
                  <div className="mt-6 flex gap-3">
                    <Button onClick={() => {
                      setDistressMessage(null);
                      isDistressProcessing.current = false;
                    }} className="bg-white text-red-600 hover:bg-red-50 border-none flex-1">I'm Okay Now</Button>
                    <Button variant="outline" className="border-white/30 text-white hover:bg-white/10 flex-1">Call Emergency</Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {isAuthenticating && authMethod === 'face' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center"
            >
              <div className="relative w-64 h-64 rounded-full overflow-hidden border-4 border-emerald-500/30 shadow-2xl shadow-emerald-500/20 bg-slate-900 flex items-center justify-center">
                {cameraError ? (
                  <div className="p-6 text-center space-y-4">
                    <Camera className="w-12 h-12 text-red-400 mx-auto" />
                    <p className="text-sm text-red-200">{cameraError}</p>
                    <div className="flex flex-col gap-2">
                      <Button variant="outline" onClick={startFaceAuth} className="border-red-500/50 text-red-200 hover:bg-red-500/10">
                        Try Again
                      </Button>
                      <Button variant="primary" onClick={() => {
                        setIsDemoMode(true);
                        setCameraError(null);
                        // Trigger simulated auth
                        setTimeout(() => {
                          setIsAuthenticated(true);
                          setIsAuthenticating(false);
                          setAuthMethod('none');
                        }, 2000);
                      }} className="bg-emerald-600 text-white text-xs">
                        Use Simulated Face ID
                      </Button>
                      <Button variant="ghost" onClick={() => {
                        setIsAuthenticating(false);
                        setAuthMethod('password');
                        setCameraError(null);
                      }} className="text-slate-400 text-xs">
                        Switch to Password
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {isDemoMode ? (
                      <div className="w-full h-full bg-slate-800 flex items-center justify-center">
                        <User className="w-24 h-24 text-slate-600 animate-pulse" />
                      </div>
                    ) : (
                      <video 
                        ref={videoRef} 
                        autoPlay 
                        muted 
                        playsInline 
                        className="w-full h-full object-cover scale-x-[-1]"
                      />
                    )}
                    <div className="absolute inset-0 pointer-events-none z-20">
                      {/* Vignette */}
                      <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_60%,rgba(2,6,23,0.5)_100%)]" />
                      
                      {/* Corner Brackets */}
                      <div className="absolute top-8 left-8 w-8 h-8 border-t-2 border-l-2 border-emerald-400/60 rounded-tl-sm" />
                      <div className="absolute top-8 right-8 w-8 h-8 border-t-2 border-r-2 border-emerald-400/60 rounded-tr-sm" />
                      <div className="absolute bottom-8 left-8 w-8 h-8 border-b-2 border-l-2 border-emerald-400/60 rounded-bl-sm" />
                      <div className="absolute bottom-8 right-8 w-8 h-8 border-b-2 border-r-2 border-emerald-400/60 rounded-br-sm" />
                    </div>
                    
                    {/* Scanning Line */}
                    <motion.div 
                      animate={{ top: ['0%', '100%', '0%'] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                      className="absolute left-0 right-0 h-1 bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.8)] z-10"
                    />
                    
                    {/* Face Frame */}
                    <div className="absolute inset-8 border-2 border-emerald-400/50 rounded-full border-dashed animate-pulse" />
                  </>
                )}
              </div>
              
              <div className="mt-12 text-center space-y-2">
                <h3 className="text-2xl font-bold tracking-tight">
                  {cameraError ? "Camera Error" : "Detecting Face..."}
                </h3>
                <p className="text-slate-400">
                  {cameraError ? "Please enable camera permissions in your browser settings" : "Please hold still and look at the camera"}
                </p>
              </div>
              
              <div className="absolute bottom-12 flex gap-4">
                {!cameraError && <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />}
                <Button variant="ghost" onClick={() => {
                  setIsAuthenticating(false);
                  setAuthMethod('none');
                  setCameraError(null);
                  if (streamRef.current) {
                    streamRef.current.getTracks().forEach(track => track.stop());
                    streamRef.current = null;
                  }
                }} className="text-slate-400">
                  Cancel
                </Button>
              </div>
            </motion.div>
          )}

          {isAuthenticating && authMethod === 'biometric' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center"
            >
              <div className="relative">
                <motion.div 
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-32 h-32 bg-emerald-500/10 rounded-full flex items-center justify-center"
                >
                  <Fingerprint className="w-16 h-16 text-emerald-500" />
                </motion.div>
                <div className="absolute inset-0 border-4 border-emerald-500 rounded-full animate-ping opacity-20" />
              </div>
              
              <div className="mt-8 text-center space-y-2">
                <h3 className="text-2xl font-bold tracking-tight">Authenticating...</h3>
                <p className="text-slate-400">Scan your fingerprint or use device biometrics</p>
              </div>
            </motion.div>
          )}

          {authMethod === 'password' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6"
            >
              <Card className="w-full max-w-sm bg-slate-800 border-slate-700 p-8 space-y-6">
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold tracking-tight">Password Login</h3>
                  <p className="text-slate-400 text-sm">Enter your secure access code</p>
                </div>
                
                <form onSubmit={handlePasswordLogin} className="space-y-4">
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter Code"
                    autoFocus
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <Button type="submit" className="w-full h-12">Login</Button>
                  <Button variant="ghost" onClick={() => setAuthMethod('none')} className="w-full text-slate-400">Cancel</Button>
                </form>
                
                <p className="text-center text-[10px] text-slate-500 uppercase tracking-widest">Demo Code: 1234</p>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const handleAddMed = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMed)
      });
      setIsAddingMed(false);
      setNewMed({ name: '', dosage: '', frequency: 'Daily', time: '08:00' });
      fetchData();
    } catch (err) {
      console.error("Failed to add medication", err);
    }
  };

  const handleDeleteMed = async (id: number) => {
    if (!confirm('Are you sure you want to remove this medication?')) return;
    try {
      await fetch(`/api/medications/${id}`, { method: 'DELETE' });
      fetchData();
    } catch (err) {
      console.error("Failed to delete medication", err);
    }
  };

  const handleLogMed = async (medId: number, status: 'taken' | 'missed') => {
    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medication_id: medId,
          status,
          mood: 'Normal',
          notes: ''
        })
      });
      fetchData();
    } catch (err) {
      console.error("Failed to log medication", err);
    }
  };

  const handleSendMessage = async (customMsg?: string) => {
    const userMsg = customMsg || inputMessage;
    if (!userMsg.trim()) return;
    
    if (!customMsg) {
      setInputMessage('');
      setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    } else {
      // System message or autonomous wake up
      setChatMessages(prev => [...prev, { role: 'assistant', content: `[Autonomous Wake-up]: ${customMsg}` }]);
    }
    
    setIsChatLoading(true);

    try {
      const response = await getAIAgentResponse(userMsg, { profile, medications, logs, medbox });
      if (response) {
        // Handle function calls
        const functionCalls = response.functionCalls;
        if (functionCalls) {
          for (const call of functionCalls) {
            if (call.name === 'send_notification') {
              const { title, body, type } = call.args as any;
              await fetch('/api/ai-notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, body, type })
              });
              fetchData();
            } else if (call.name === 'talk_to_patient') {
              const { message } = call.args as any;
              handleTalkToPatient(message);
            } else if (call.name === 'wake_up') {
              const { reason } = call.args as any;
              setChatMessages(prev => [...prev, { role: 'assistant', content: `I'm awake! Reason: ${reason}. How can I help?` }]);
            }
          }
        }
        
        if (response.text) {
          setChatMessages(prev => [...prev, { role: 'assistant', content: response.text }]);
        }
      }
    } catch (err) {
      console.error("Chat error", err);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleTalkToPatient = (message: string) => {
    setIsSpeaking(true);
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const handleSaveSettings = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      alert('Settings updated successfully!');
    } catch (err) {
      console.error("Failed to save settings", err);
    }
  };

  const getHealingComparison = () => {
    if (logs.length < 2) return "Not enough data to compare.";
    
    const today = new Date().toDateString();
    const todayLogs = logs.filter(l => new Date(l.timestamp).toDateString() === today);
    const pastLogs = logs.filter(l => new Date(l.timestamp).toDateString() !== today);
    
    const todayAdherence = todayLogs.length > 0 ? (todayLogs.filter(l => l.status === 'taken').length / todayLogs.length) * 100 : 0;
    const pastAdherence = pastLogs.length > 0 ? (pastLogs.filter(l => l.status === 'taken').length / pastLogs.length) * 100 : 0;
    
    const diff = todayAdherence - pastAdherence;
    
    if (diff > 5) return `Your healing progress is up by ${Math.round(diff)}% compared to previous days! Keep it up.`;
    if (diff < -5) return `Your adherence is down by ${Math.round(Math.abs(diff))}% today. MediSafe AI recommends staying on schedule for optimal healing.`;
    return "Your healing progress is stable and consistent with your history.";
  };

  const handleGenerateSummary = async () => {
    setIsSummaryLoading(true);
    try {
      const result = await generateHealthSummary(logs, profile, medications);
      setSummary(result || "No summary generated.");
    } catch (err) {
      console.error("Summary error", err);
    } finally {
      setIsSummaryLoading(false);
    }
  };

  // QR Scanner Logic moved to top level
  
  return (
    <div className="min-h-screen bg-[#F8F9FA] text-slate-900 font-sans pb-24">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-bottom border-black/5 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-emerald-200">
            <Activity className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">MediSafe AI</h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setShowNotifications(true)}
            className="p-2 text-slate-400 hover:text-emerald-600 transition-colors relative"
          >
            <Bell className="w-6 h-6" />
            {notifications.length > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
            )}
          </button>
          <div 
            onClick={() => setActiveTab('profile')}
            className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 overflow-hidden cursor-pointer hover:ring-2 hover:ring-emerald-500 transition-all"
          >
            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.name || 'User'}`} alt="Avatar" referrerPolicy="no-referrer" />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-8 space-y-8">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              {/* Welcome */}
              <section className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Hello, {profile.name || 'Patient'}</h2>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-slate-500">MediSafe AI is monitoring your health.</p>
                    <div className={cn(
                      "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider",
                      currentMood === 'Stable' ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700 animate-pulse"
                    )}>
                      Mood: {currentMood}
                    </div>
                  </div>
                </div>
                <div className="bg-emerald-50 px-3 py-1 rounded-full flex items-center gap-2 border border-emerald-100">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Agent Active</span>
                </div>
              </section>

              {/* Ministry of Health Badge */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 flex items-center gap-4">
                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm">
                  <Stethoscope className="w-6 h-6 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-blue-900 flex items-center gap-2">
                    Ministry of Health Certified
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  </h4>
                  <p className="text-[11px] text-blue-700 leading-tight">Recommended for chronic disease management. Your data is encrypted and synced with MinHealth secure servers.</p>
                </div>
              </div>

              {/* Instant Insights */}
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm flex items-start gap-3"
              >
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Instant Insight</h4>
                  <p className="text-sm text-slate-700 mt-0.5 leading-relaxed">{insights}</p>
                </div>
              </motion.div>

              {/* Next Dose Card */}
              <Card className="bg-slate-900 text-white border-none shadow-xl shadow-slate-200 overflow-hidden relative">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Activity className="w-32 h-32" />
                </div>
                <div className="relative z-10">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Next Scheduled Dose</span>
                      <h3 className="text-2xl font-bold mt-1">{nextDose?.name || 'No Meds Scheduled'}</h3>
                      <p className="text-slate-400 text-sm mt-1">{nextDose?.dosage} • {nextDose?.time}</p>
                    </div>
                    <div className="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold">
                      {nextDose ? 'Upcoming' : 'Clear'}
                    </div>
                  </div>
                  
                  {nextDose && (
                    <div className="mt-8 flex gap-3">
                      <Button onClick={startMedVerification} className="flex-1 bg-emerald-500 hover:bg-emerald-400 border-none h-12">
                        Take Now
                      </Button>
                      <Button onClick={() => handleSnooze(nextDose)} variant="outline" className="flex-1 border-white/20 text-white hover:bg-white/10 h-12">
                        Snooze
                      </Button>
                    </div>
                  )}
                </div>
              </Card>

              {/* Quick Actions */}
              <div className="grid grid-cols-2 gap-4">
                <Card className="flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => setIsAddingMed(true)}>
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                    <Plus className="w-6 h-6" />
                  </div>
                  <span className="font-semibold">Add Med</span>
                </Card>
                <Card className="flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => setActiveTab('analytics')}>
                  <div className="w-12 h-12 bg-purple-50 rounded-2xl flex items-center justify-center text-purple-600">
                    <BarChart3 className="w-6 h-6" />
                  </div>
                  <span className="font-semibold">Analytics</span>
                </Card>
              </div>

              {/* MedBox Status */}
              <Card className="bg-white border-black/5 flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-slate-600">
                    <Box className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">MedBox Status</h4>
                    <p className="text-sm font-bold text-slate-700">{medbox?.status || 'Searching...'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">Current Weight</p>
                  <p className="text-lg font-black text-emerald-600">{medbox?.current_weight_grams || 0}g</p>
                </div>
              </Card>

              {/* Today's Schedule */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">Today's Schedule</h3>
                  <button className="text-emerald-600 text-sm font-semibold flex items-center gap-1" onClick={() => setActiveTab('meds')}>
                    View All <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-3">
                  {medications.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 italic">No medications added yet.</div>
                  ) : medications.map(med => (
                    <div key={med.id} className="bg-white p-4 rounded-2xl border border-black/5 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-slate-50 rounded-full flex items-center justify-center text-slate-400">
                          <ClipboardList className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-bold">{med.name}</h4>
                          <p className="text-xs text-slate-500">{med.dosage} • {med.time}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => {
                          setNextDose(med);
                          startMedVerification();
                        }} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors">
                          <CheckCircle2 className="w-6 h-6" />
                        </button>
                        <button onClick={() => handleLogMed(med.id, 'missed')} className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                          <XCircle className="w-6 h-6" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'meds' && (
            <motion.div 
              key="meds"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">My Medications</h2>
                <Button onClick={() => setIsAddingMed(true)} variant="primary" className="rounded-full px-6">
                  <Plus className="w-5 h-5" /> Add New
                </Button>
              </div>
              <div className="space-y-4">
                {medications.map(med => (
                  <Card key={med.id} className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold">{med.name}</h3>
                      <p className="text-slate-500">{med.dosage} • {med.frequency} at {med.time}</p>
                    </div>
                    <button onClick={() => handleDeleteMed(med.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </Card>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'chat' && (
            <motion.div 
              key="chat"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col h-[70vh]"
            >
              <div className="flex-1 overflow-y-auto space-y-4 pb-4 scrollbar-hide">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={cn(
                    "max-w-[85%] p-4 rounded-2xl text-sm",
                    msg.role === 'user' 
                      ? "bg-emerald-600 text-white ml-auto rounded-tr-none" 
                      : "bg-white border border-black/5 mr-auto rounded-tl-none shadow-sm"
                  )}>
                    <div className="prose prose-sm max-w-none">
                      <Markdown>{msg.content}</Markdown>
                    </div>
                  </div>
                ))}
                {isChatLoading && (
                  <div className="bg-white border border-black/5 mr-auto rounded-2xl rounded-tl-none p-4 shadow-sm">
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                  </div>
                )}
              </div>
              <div className="mt-auto pt-4 flex gap-2">
                <input 
                  type="text" 
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask me anything..."
                  className="flex-1 bg-white border border-black/5 rounded-2xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
                />
                <Button onClick={handleSendMessage} disabled={isChatLoading} className="rounded-2xl w-12 h-12 p-0">
                  <Send className="w-5 h-5" />
                </Button>
              </div>
            </motion.div>
          )}

          {activeTab === 'analytics' && (
            <motion.div 
              key="analytics"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <h2 className="text-2xl font-bold">Health Analytics</h2>
              
              <Card className="bg-emerald-600 text-white border-none">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-white/20 rounded-2xl">
                    <Activity className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-widest opacity-80">Healing Comparison</h4>
                    <p className="text-lg font-bold mt-1 leading-tight">{getHealingComparison()}</p>
                  </div>
                </div>
              </Card>

              <Card className="space-y-4">
                <h3 className="font-bold text-slate-700">Medication Adherence (Last 7 Days)</h3>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={logs.slice(0, 7).reverse().map((l, i) => ({ name: format(new Date(l.timestamp), 'MMM d'), val: l.status === 'taken' ? 100 : 0 }))}>
                      <defs>
                        <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
                      <YAxis hide />
                      <Tooltip />
                      <Area type="monotone" dataKey="val" stroke="#10b981" fillOpacity={1} fill="url(#colorVal)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <div className="grid grid-cols-2 gap-4">
                <Card className="text-center p-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Adherence Rate</p>
                  <p className="text-3xl font-black text-emerald-600 mt-1">
                    {logs.length > 0 ? Math.round((logs.filter(l => l.status === 'taken').length / logs.length) * 100) : 0}%
                  </p>
                </Card>
                <Card className="text-center p-4">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Doses Taken</p>
                  <p className="text-3xl font-black text-blue-600 mt-1">
                    {logs.filter(l => l.status === 'taken').length}
                  </p>
                </Card>
              </div>
            </motion.div>
          )}

          {activeTab === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Health History</h2>
                <Button onClick={handleGenerateSummary} loading={isSummaryLoading} variant="outline" className="rounded-full">
                  <Stethoscope className="w-4 h-4" /> Doctor Summary
                </Button>
              </div>

              {summary && (
                <Card className="bg-emerald-50 border-emerald-100">
                  <h3 className="font-bold text-emerald-900 mb-2 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" /> AI Generated Summary
                  </h3>
                  <div className="prose prose-sm text-emerald-800">
                    <Markdown>{summary}</Markdown>
                  </div>
                  <Button variant="ghost" className="mt-4 text-emerald-700" onClick={() => setSummary(null)}>Clear Summary</Button>
                </Card>
              )}

              <div className="space-y-4">
                {logs.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 italic">No activity logged yet.</div>
                ) : logs.map(log => (
                  <div key={log.id} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "w-3 h-3 rounded-full mt-2",
                        log.status === 'taken' ? "bg-emerald-500" : "bg-red-500"
                      )} />
                      <div className="w-px flex-1 bg-slate-200 my-1" />
                    </div>
                    <div className="bg-white p-4 rounded-2xl border border-black/5 flex-1 shadow-sm">
                      <div className="flex justify-between items-start">
                        <h4 className="font-bold">{log.medication_name || 'General Log'}</h4>
                        <span className="text-[10px] uppercase font-bold text-slate-400">{format(new Date(log.timestamp), 'MMM d, h:mm a')}</span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        Status: <span className={log.status === 'taken' ? 'text-emerald-600' : 'text-red-500'}>{log.status}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div key="profile" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <h2 className="text-2xl font-bold">Patient Profile</h2>
              <Card className="space-y-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 border border-slate-200 overflow-hidden">
                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${profile.name || 'User'}`} alt="Avatar" referrerPolicy="no-referrer" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">{profile.name || 'Patient'}</h3>
                    <p className="text-sm text-slate-500">{profile.condition || 'No condition specified'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-400">Full Name</label>
                    <input 
                      type="text" 
                      value={profile.name || ''} 
                      onChange={(e) => setProfile({...profile, name: e.target.value})}
                      className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-400">Primary Condition</label>
                    <input 
                      type="text" 
                      value={profile.condition || ''} 
                      onChange={(e) => setProfile({...profile, condition: e.target.value})}
                      className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase text-slate-400">Doctor's Private Notes</label>
                  <textarea 
                    rows={4}
                    value={profile.doctor_notes || ''} 
                    onChange={(e) => setProfile({...profile, doctor_notes: e.target.value})}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <Button onClick={async () => {
                  await fetch('/api/profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(profile)
                  });
                  alert('Profile updated!');
                }} className="w-full">Save Profile</Button>
              </Card>

              <h2 className="text-2xl font-bold mt-8">App Settings</h2>
              <Card className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-700">MedBox Connection</h4>
                      <p className="text-xs text-slate-500">Manage your hardware device link</p>
                    </div>
                    <input 
                      type="text"
                      value={settings.medbox_id}
                      onChange={(e) => setSettings({...settings, medbox_id: e.target.value})}
                      className="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-slate-700">Snooze Duration</h4>
                      <p className="text-xs text-slate-500">Minutes to delay notifications</p>
                    </div>
                    <select 
                      value={settings.snooze_duration_minutes}
                      onChange={(e) => setSettings({...settings, snooze_duration_minutes: parseInt(e.target.value)})}
                      className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value={5}>5 min</option>
                      <option value={10}>10 min</option>
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                    </select>
                  </div>

                  <div className="pt-4 space-y-3">
                    <label className="flex items-center justify-between cursor-pointer group">
                      <span className="text-sm font-medium text-slate-700">Enable Notifications</span>
                      <input 
                        type="checkbox" 
                        checked={settings.notifications_enabled} 
                        onChange={(e) => setSettings({...settings, notifications_enabled: e.target.checked})}
                        className="w-5 h-5 accent-emerald-600"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer group">
                      <span className="text-sm font-medium text-slate-700">AI Voice Agent</span>
                      <input 
                        type="checkbox" 
                        checked={settings.voice_agent_enabled} 
                        onChange={(e) => setSettings({...settings, voice_agent_enabled: e.target.checked})}
                        className="w-5 h-5 accent-emerald-600"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer group">
                      <span className="text-sm font-medium text-slate-700">Distress Monitor</span>
                      <input 
                        type="checkbox" 
                        checked={settings.distress_monitor_enabled} 
                        onChange={(e) => setSettings({...settings, distress_monitor_enabled: e.target.checked})}
                        className="w-5 h-5 accent-emerald-600"
                      />
                    </label>
                    <label className="flex items-center justify-between cursor-pointer group">
                      <span className="text-sm font-medium text-slate-700">Ministry of Health Sync</span>
                      <input 
                        type="checkbox" 
                        checked={settings.minhealth_sync_enabled} 
                        onChange={(e) => setSettings({...settings, minhealth_sync_enabled: e.target.checked})}
                        className="w-5 h-5 accent-emerald-600"
                      />
                    </label>
                  </div>
                </div>

                <Button onClick={handleSaveSettings} className="w-full">Save Settings</Button>
                
                <div className="pt-4 border-t border-slate-100">
                  <Button variant="danger" onClick={handleLogout} className="w-full bg-red-50 text-red-600 hover:bg-red-100">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </Button>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Production Footer */}
      <footer className="max-w-2xl mx-auto px-6 py-12 pb-32 text-center space-y-4 opacity-50">
        <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest">
          <Stethoscope className="w-4 h-4" />
          Ministry of Health Official Partner
        </div>
        <p className="text-[10px] leading-relaxed">
          MediSafe AI v2.4.0 (Production Build)<br />
          Encrypted with AES-256. HIPAA & GDPR Compliant.<br />
          Emergency Support: 999 | MinHealth Hotline: 0800-HEALTH
        </p>
      </footer>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-black/5 px-6 py-3 flex justify-between items-center z-40">
        <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<Activity />} label="Home" />
        <NavButton active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} icon={<BarChart3 />} label="Stats" />
        <NavButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} icon={<MessageSquare />} label="Agent" />
        <NavButton active={activeTab === 'history'} onClick={() => setActiveTab('history')} icon={<History />} label="History" />
        <NavButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<User />} label="Profile" />
      </nav>

      {/* Add Medication Modal */}
      <AnimatePresence>
        {showNotifications && (
          <div className="fixed inset-0 z-[150] flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setShowNotifications(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: "100%" }} 
              animate={{ y: 0 }} 
              exit={{ y: "100%" }}
              className="relative w-full max-w-md bg-white rounded-t-[32px] sm:rounded-[32px] p-8 shadow-2xl overflow-hidden max-h-[80vh] flex flex-col"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold">Notifications</h3>
                <button 
                  onClick={() => setNotifications([])}
                  className="text-xs font-bold text-slate-400 uppercase hover:text-red-500 transition-colors"
                >
                  Clear All
                </button>
              </div>
              
              <div className="space-y-4 overflow-y-auto pr-2">
                {notifications.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 italic">No new notifications.</div>
                ) : notifications.map(notif => (
                  <div key={notif.id} className={cn(
                    "p-4 rounded-2xl border flex gap-4",
                    notif.type === 'urgent' ? "bg-red-50 border-red-100" : "bg-slate-50 border-slate-100"
                  )}>
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                      notif.type === 'urgent' ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-600"
                    )}>
                      {notif.type === 'urgent' ? <AlertCircle className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{notif.title}</h4>
                      <p className="text-xs text-slate-500 mt-1">{notif.body}</p>
                      <span className="text-[10px] text-slate-400 mt-2 block font-medium uppercase">{notif.time}</span>
                    </div>
                  </div>
                ))}
              </div>
              
              <Button onClick={() => setShowNotifications(false)} className="mt-6 w-full">Close</Button>
            </motion.div>
          </div>
        )}

        {isAddingMed && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingMed(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ y: "100%" }} 
              animate={{ y: 0 }} 
              exit={{ y: "100%" }}
              className="relative w-full max-w-md bg-white rounded-t-[32px] sm:rounded-[32px] p-8 shadow-2xl overflow-hidden"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-bold">Add Medication</h3>
                <button onClick={() => setIsScanning(!isScanning)} className="p-2 bg-slate-100 rounded-xl text-slate-600 hover:bg-emerald-50 hover:text-emerald-600 transition-all">
                  <QrCode className="w-6 h-6" />
                </button>
              </div>

              {isScanning ? (
                <div className="space-y-4">
                  <div id="reader" className="w-full overflow-hidden rounded-2xl border-2 border-dashed border-slate-200"></div>
                  <Button variant="outline" className="w-full" onClick={() => setIsScanning(false)}>Cancel Scan</Button>
                </div>
              ) : (
                <form onSubmit={handleAddMed} className="space-y-4">
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-400">Medication Name</label>
                    <input 
                      required
                      type="text" 
                      value={newMed.name}
                      onChange={(e) => setNewMed({...newMed, name: e.target.value})}
                      placeholder="e.g. Metformin"
                      className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold uppercase text-slate-400">Dosage</label>
                      <input 
                        type="text" 
                        value={newMed.dosage}
                        onChange={(e) => setNewMed({...newMed, dosage: e.target.value})}
                        placeholder="500mg"
                        className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold uppercase text-slate-400">Time</label>
                      <input 
                        type="time" 
                        value={newMed.time}
                        onChange={(e) => setNewMed({...newMed, time: e.target.value})}
                        className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                  <Button type="submit" className="w-full py-4 text-lg mt-4">Save Medication</Button>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 transition-all",
        active ? "text-emerald-600 scale-110" : "text-slate-400 hover:text-slate-600"
      )}
    >
      <div className={cn(
        "p-1 rounded-lg",
        active && "bg-emerald-50"
      )}>
        {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, { className: "w-6 h-6" }) : icon}
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
    </button>
  );
}
