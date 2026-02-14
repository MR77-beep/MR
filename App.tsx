
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Mic, 
  Settings, 
  History, 
  Wifi, 
  Play, 
  Trash2, 
  Calendar, 
  Clock,
  Volume2,
  VolumeX,
  Share2,
  Lock,
  Zap,
  ChevronDown,
  SlidersHorizontal,
  Headphones,
  Sparkles
} from 'lucide-react';
import { Recording } from './types';
import { getAllRecordings, saveRecording, deleteRecording } from './services/storageService';

const App: React.FC = () => {
  // UI State
  const [activeTab, setActiveTab] = useState<'recorder' | 'library' | 'remote'>('recorder');
  const [recordings, setRecordings] = useState<Recording[]>([]);
  
  // Audio Devices
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
  // Recorder State
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeakerEnabled, setIsSpeakerEnabled] = useState(false);
  const [isAGCEnabled, setIsAGCEnabled] = useState(false); // Nowy stan AGC
  const [currentVolume, setCurrentVolume] = useState(0); 
  const [currentDB, setCurrentDB] = useState(-60); 
  const [threshold, setThreshold] = useState(0.15);
  const [inputGain, setInputGain] = useState(1.0); 
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const agcTimerRef = useRef<number | null>(null);

  // Initial setup
  useEffect(() => {
    refreshRecordings();
    loadDevices();
    navigator.mediaDevices.ondevicechange = loadDevices;
    return () => {
      navigator.mediaDevices.ondevicechange = null;
      if (agcTimerRef.current) cancelAnimationFrame(agcTimerRef.current);
    };
  }, []);

  // Update gain node when state changes
  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      gainNodeRef.current.gain.setTargetAtTime(inputGain, audioContextRef.current.currentTime, 0.1);
    }
  }, [inputGain]);

  // Handle speaker monitoring toggle
  useEffect(() => {
    if (gainNodeRef.current && audioContextRef.current) {
      if (isSpeakerEnabled) {
        gainNodeRef.current.connect(audioContextRef.current.destination);
      } else {
        try {
          gainNodeRef.current.disconnect(audioContextRef.current.destination);
        } catch (e) {}
      }
    }
  }, [isSpeakerEnabled, isMonitoring]);

  const loadDevices = async () => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = allDevices.filter(device => device.kind === 'audioinput');
      setDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(audioInputs[0].deviceId);
      }
    } catch (err) {
      console.error("Błąd podczas listowania urządzeń:", err);
    }
  };

  const refreshRecordings = async () => {
    const data = await getAllRecordings();
    setRecordings(data);
  };

  const startMonitoring = async () => {
    if (isMonitoring) stopMonitoring();

    try {
      const constraints = {
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const gainNode = audioCtx.createGain();
      gainNode.gain.value = inputGain;
      gainNodeRef.current = gainNode;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      
      source.connect(gainNode);
      gainNode.connect(analyser);
      
      if (isSpeakerEnabled) {
        gainNode.connect(audioCtx.destination);
      }
      
      analyserRef.current = analyser;
      setIsMonitoring(true);
      monitorVolume();
    } catch (err) {
      console.error("Błąd mikrofonu:", err);
      alert("Wymagany dostęp do mikrofonu!");
    }
  };

  const stopMonitoring = () => {
    setIsMonitoring(false);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioContextRef.current) audioContextRef.current.close();
    gainNodeRef.current = null;
    setCurrentVolume(0);
    setCurrentDB(-60);
    if (agcTimerRef.current) cancelAnimationFrame(agcTimerRef.current);
  };

  const monitorVolume = () => {
    if (!analyserRef.current) return;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const check = () => {
      if (!analyserRef.current || !isMonitoring) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      
      let max = 0;
      for (let i = 0; i < dataArray.length; i++) {
        if (dataArray[i] > max) max = dataArray[i];
      }
      
      const linearValue = max / 255;
      setCurrentVolume(linearValue);
      const db = linearValue > 0 ? 20 * Math.log10(linearValue) : -60;
      setCurrentDB(Math.max(-60, db));

      // LOGIKA AGC
      if (isAGCEnabled && isMonitoring) {
        const targetLevel = 0.35; // Cel: ok. -9dB
        const tolerance = 0.08;
        
        if (linearValue > 0.01) { // Tylko gdy jest sygnał
          if (linearValue > targetLevel + tolerance) {
            // Szybkie tłumienie przy zbyt głośnym sygnale
            setInputGain(prev => Math.max(0.1, prev - 0.04));
          } else if (linearValue < targetLevel - tolerance) {
            // Powolne podbijanie przy zbyt cichym sygnale
            setInputGain(prev => Math.min(5.0, prev + 0.005));
          }
        }
      }

      if (linearValue > threshold) {
        if (!isRecording) startAudioRecording();
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else if (isRecording && !silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          stopAudioRecording();
        }, 2000);
      }

      agcTimerRef.current = requestAnimationFrame(check);
    };
    check();
  };

  const startAudioRecording = () => {
    if (!streamRef.current || isRecording) return;
    const mediaRecorder = new MediaRecorder(streamRef.current);
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const now = new Date();
      const newRecording: Recording = {
        id: crypto.randomUUID(),
        blob,
        timestamp: now,
        duration: 0,
        peakLevel: threshold,
        dateStr: now.toLocaleDateString('pl-PL'),
        timeStr: now.toLocaleTimeString('pl-PL')
      };
      await saveRecording(newRecording);
      refreshRecordings();
    };
    mediaRecorder.start();
    setIsRecording(true);
  };

  const stopAudioRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteRecording(id);
    refreshRecordings();
  };

  const playRecording = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
  };

  const groupedRecordings = useMemo(() => {
    const groups: Record<string, Recording[]> = {};
    recordings.forEach(rec => {
      if (!groups[rec.dateStr]) groups[rec.dateStr] = [];
      groups[rec.dateStr].push(rec);
    });
    return groups;
  }, [recordings]);

  const getMeterColor = (db: number) => {
    if (db > -6) return 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]';
    if (db > -18) return 'bg-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.5)]';
    return 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500">
      <header className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg">
            <Wifi className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">SoundLink <span className="text-indigo-500">2.0</span></h1>
            <p className="text-xs text-slate-400">Logistyka Dźwięku</p>
          </div>
        </div>
        <div className="flex gap-2">
          {isMonitoring && (
            <span className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-500 rounded-full text-xs font-bold animate-pulse">
              <div className="w-2 h-2 bg-red-500 rounded-full" /> LIVE
            </span>
          )}
        </div>
      </header>

      <main className="p-4 md:p-8 max-w-4xl mx-auto pb-24">
        {activeTab === 'recorder' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Vizualizer Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-800">
                <div 
                  className={`h-full transition-all duration-75 ease-out ${getMeterColor(currentDB)}`} 
                  style={{ width: `${((currentDB + 60) / 60) * 100}%` }}
                />
              </div>

              <div className="flex flex-col items-center gap-6">
                <div className="w-full flex justify-between text-[10px] font-mono text-slate-500 px-1">
                  <span>-60dB</span>
                  <span>-40dB</span>
                  <span>-20dB</span>
                  <span>-10dB</span>
                  <span>-6dB</span>
                  <span className="text-red-500">0dB</span>
                </div>

                <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${isMonitoring ? 'bg-indigo-600/20 shadow-[0_0_50px_rgba(79,70,229,0.3)]' : 'bg-slate-800'}`}>
                   {isRecording ? (
                     <div className="relative">
                        <Zap className="w-12 h-12 text-red-500 animate-bounce" />
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
                     </div>
                   ) : (
                     <Mic className={`w-12 h-12 ${isMonitoring ? 'text-indigo-400' : 'text-slate-500'}`} />
                   )}
                </div>

                <div className="text-center">
                  <h2 className="text-2xl font-bold">{isRecording ? 'Nagrywanie...' : isMonitoring ? 'Oczekiwanie' : 'Monitor wyłączony'}</h2>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <span className={`text-lg font-mono font-bold ${currentDB > -10 ? 'text-red-500' : 'text-indigo-400'}`}>
                      {currentDB.toFixed(1)} dB
                    </span>
                    <span className="text-slate-500 text-sm">/ {Math.round(currentVolume * 100)}%</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={isMonitoring ? stopMonitoring : startMonitoring}
                    className={`px-10 py-4 rounded-2xl font-bold transition-all transform active:scale-95 ${
                      isMonitoring 
                      ? 'bg-slate-800 text-slate-200 hover:bg-slate-700' 
                      : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-xl shadow-indigo-500/20'
                    }`}
                  >
                    {isMonitoring ? 'Zatrzymaj Monitor' : 'Uruchom Nasłuch'}
                  </button>
                  
                  <button
                    onClick={() => setIsSpeakerEnabled(!isSpeakerEnabled)}
                    className={`p-4 rounded-2xl border transition-all transform active:scale-95 flex items-center justify-center ${
                      isSpeakerEnabled 
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-lg shadow-emerald-500/10' 
                      : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'
                    }`}
                    title={isSpeakerEnabled ? "Wyłącz odsłuch" : "Włącz odsłuch na głośnikach"}
                  >
                    {isSpeakerEnabled ? <Headphones className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Config Card Expanded */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Audio Input & Gain Section */}
                <div className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-slate-300">
                      <Volume2 className="w-5 h-5 text-indigo-400" />
                      <h3 className="font-bold">Wejście Audio</h3>
                    </div>
                    <div className="relative">
                      <select 
                        value={selectedDeviceId}
                        onChange={(e) => {
                          setSelectedDeviceId(e.target.value);
                          if (isMonitoring) {
                            setTimeout(startMonitoring, 100);
                          }
                        }}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-200 rounded-xl px-4 py-3 appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      >
                        {devices.length > 0 ? devices.map(device => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {device.label || `Mikrofon ${device.deviceId.slice(0, 5)}`}
                          </option>
                        )) : (
                          <option value="">Brak urządzeń</option>
                        )}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-slate-300">
                      <div className="flex items-center gap-2">
                        <SlidersHorizontal className="w-5 h-5 text-indigo-400" />
                        <h3 className="font-bold">Wzmocnienie (Gain)</h3>
                      </div>
                      
                      {/* AGC TOGGLE BUTTON */}
                      <button 
                        onClick={() => setIsAGCEnabled(!isAGCEnabled)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                          isAGCEnabled 
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' 
                          : 'bg-slate-800 text-slate-500 hover:text-slate-400'
                        }`}
                      >
                        <Sparkles className={`w-3 h-3 ${isAGCEnabled ? 'animate-pulse' : ''}`} />
                        {isAGCEnabled ? 'Auto AGC ON' : 'Auto AGC OFF'}
                      </button>
                    </div>

                    <div>
                      <div className="flex justify-between mb-2 text-sm">
                        <span className="text-slate-400">Poziom sygnału</span>
                        <div className="flex items-center gap-2">
                          {isAGCEnabled && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping" />}
                          <span className={`font-mono ${isAGCEnabled ? 'text-indigo-400 font-bold' : 'text-slate-400'}`}>
                            {inputGain.toFixed(1)}x
                          </span>
                        </div>
                      </div>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="5.0" 
                        step="0.1" 
                        value={inputGain}
                        onChange={(e) => {
                          setInputGain(parseFloat(e.target.value));
                          if (isAGCEnabled) setIsAGCEnabled(false); // Wyłącz AGC przy ręcznej zmianie
                        }}
                        className={`w-full h-2 rounded-lg appearance-none cursor-pointer transition-colors ${
                          isAGCEnabled ? 'bg-indigo-500/30 accent-white' : 'bg-slate-800 accent-indigo-500'
                        }`}
                      />
                      <div className="flex justify-between mt-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                        <span>0.1x</span>
                        <span className={isAGCEnabled ? 'text-indigo-500' : ''}>
                          {isAGCEnabled ? 'Automatyczna regulacja' : 'Ręczna regulacja'}
                        </span>
                        <span>5.0x</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* VOX Threshold Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-slate-300">
                    <Settings className="w-5 h-5 text-indigo-400" />
                    <h3 className="font-bold">Automatyzacja VOX</h3>
                  </div>
                  <div className="p-4 bg-slate-800/40 border border-slate-700/50 rounded-2xl space-y-4">
                    <div>
                      <div className="flex justify-between mb-2 text-sm">
                        <span className="text-slate-400">Próg aktywacji (Squelch)</span>
                        <span className="font-mono text-indigo-400">{Math.round(threshold * 100)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.01" 
                        max="0.5" 
                        step="0.01" 
                        value={threshold}
                        onChange={(e) => setThreshold(parseFloat(e.target.value))}
                        className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                      <div className="flex justify-between mt-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                        <span>Czuły (-40dB)</span>
                        <span>Głośny (-10dB)</span>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                        <Sparkles className="w-4 h-4 text-indigo-400" />
                        <p className="text-[10px] text-slate-400 flex-1">
                          AGC automatycznie podbija cichą mowę i tłumi krzyki. 
                          <span className="text-indigo-400"> Tryb inteligentny aktywny.</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'library' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">Twoja Biblioteka</h2>
              <button onClick={refreshRecordings} className="p-2 text-slate-400 hover:text-white transition-colors">
                <History className="w-5 h-5" />
              </button>
            </div>

            {recordings.length === 0 ? (
              <div className="text-center py-20 bg-slate-900/30 border-2 border-dashed border-slate-800 rounded-3xl">
                <Volume2 className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                <p className="text-slate-500">Brak zarejestrowanych dźwięków</p>
              </div>
            ) : (
              Object.entries(groupedRecordings).map(([date, items]) => (
                <div key={date} className="space-y-3">
                  <div className="flex items-center gap-2 text-slate-400 px-2 py-2">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm font-bold">{date}</span>
                  </div>
                  {items.map(rec => (
                    <div key={rec.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center justify-between hover:border-slate-700 transition-all group">
                      <div className="flex items-center gap-4">
                        <button 
                          onClick={() => playRecording(rec.blob)}
                          className="w-12 h-12 bg-indigo-500/10 text-indigo-500 rounded-xl flex items-center justify-center hover:bg-indigo-500 hover:text-white transition-all"
                        >
                          <Play className="w-5 h-5 fill-current" />
                        </button>
                        <div>
                          <div className="flex items-center gap-2">
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span className="font-mono text-sm">{rec.timeStr}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">Aktywowano przy: {Math.round(rec.peakLevel * 100)}% głośności</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDelete(rec.id)}
                        className="p-2 text-slate-600 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'remote' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="bg-indigo-600 rounded-3xl p-8 text-white relative overflow-hidden">
                <div className="absolute -right-20 -top-20 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
                <Share2 className="w-12 h-12 mb-6 opacity-80" />
                <h2 className="text-3xl font-bold mb-2">Zdalny Odsłuch</h2>
                <p className="opacity-80 mb-8 max-w-sm">Połącz się z innego telefonu, aby słuchać nagrań na żywo i przeglądać historię.</p>
                
                <div className="bg-black/20 backdrop-blur-md rounded-2xl p-6 border border-white/10">
                  <p className="text-xs uppercase tracking-widest font-bold mb-2 opacity-60">ID Twojej Stacji</p>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-mono font-bold tracking-tighter">SL-992-X82</span>
                    <button className="bg-white text-indigo-600 px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-50 transition-colors">
                      Kopiuj
                    </button>
                  </div>
                </div>
             </div>

             <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8">
                <div className="flex items-center gap-3 mb-6">
                  <Lock className="w-6 h-6 text-indigo-500" />
                  <h3 className="text-xl font-bold">Połącz z inną stacją</h3>
                </div>
                <div className="space-y-4">
                  <input 
                    type="text" 
                    placeholder="Wprowadź ID Stacji (np. SL-000-XXX)"
                    className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-6 py-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                  <button className="w-full bg-slate-800 text-slate-300 py-4 rounded-2xl font-bold hover:bg-slate-700 transition-all">
                    Nawiąż połączenie
                  </button>
                </div>
             </div>
          </div>
        )}

      </main>

      <nav className="fixed bottom-0 left-0 w-full bg-slate-900/80 backdrop-blur-xl border-t border-slate-800 px-6 py-4 z-50">
        <div className="max-w-md mx-auto flex justify-between items-center">
          <button 
            onClick={() => setActiveTab('recorder')}
            className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'recorder' ? 'text-indigo-500' : 'text-slate-500'}`}
          >
            <Mic className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Nagrywaj</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('library')}
            className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'library' ? 'text-indigo-500' : 'text-slate-500'}`}
          >
            <History className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Historia</span>
          </button>

          <button 
            onClick={() => setActiveTab('remote')}
            className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'remote' ? 'text-indigo-500' : 'text-slate-500'}`}
          >
            <Wifi className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-tighter">Zdalny</span>
          </button>
        </div>
      </nav>

      <style>{`
        input[type='range']::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          background: #6366f1;
          cursor: pointer;
          border-radius: 50%;
          border: 4px solid #0f172a;
          box-shadow: 0 0 10px rgba(99, 102, 241, 0.5);
        }
        select {
          background-image: none;
        }
      `}</style>
    </div>
  );
};

export default App;
