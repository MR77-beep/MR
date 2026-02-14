
import React, { useState, useRef } from 'react';
import { Camera, Package, User, MapPin, Scale, ChevronRight, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { analyzeParcelImage } from '../services/geminiService';
import { AIAnalysisResult, ShipmentStatus } from '../types';

interface ShipmentFormProps {
  onComplete: (shipment: any) => void;
}

const ShipmentForm: React.FC<ShipmentFormProps> = ({ onComplete }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AIAnalysisResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [formData, setFormData] = useState({
    sender: '',
    recipient: '',
    address: '',
    contents: '',
    length: '',
    width: '',
    height: '',
    weight: ''
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const result = await analyzeParcelImage(base64);
        setAnalysis(result);
        setFormData(prev => ({
          ...prev,
          contents: result.category,
          length: result.suggestedDimensions.length?.toString() || '',
          width: result.suggestedDimensions.width?.toString() || '',
          height: result.suggestedDimensions.height?.toString() || '',
          weight: result.suggestedDimensions.weight?.toString() || ''
        }));
        setIsAnalyzing(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error(err);
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onComplete({
      ...formData,
      id: Math.random().toString(36).substr(2, 9),
      status: ShipmentStatus.PENDING,
      createdAt: new Date(),
      dimensions: {
        length: parseFloat(formData.length),
        width: parseFloat(formData.width),
        height: parseFloat(formData.height),
        weight: parseFloat(formData.weight)
      }
    });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Nowa Przesyłka</h2>
          <p className="text-sm text-slate-500">Wypełnij dane lub użyj AI do skanowania przedmiotu</p>
        </div>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isAnalyzing}
          className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
          <span>Skanuj Przedmiot</span>
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={handleFileChange} 
        />
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {analysis && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-start space-x-4">
            <div className="bg-indigo-600 p-2 rounded-lg mt-1">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="font-bold text-indigo-900">Analiza AI Ukończona</h4>
              <p className="text-sm text-indigo-700 mt-1">
                Wykryto: <strong>{analysis.category}</strong>. Sugerowane opakowanie: {analysis.packagingAdvice}. 
                {analysis.fragile && <span className="ml-2 font-bold text-red-600">⚠ Produkt delikatny!</span>}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center">
                <User className="w-4 h-4 mr-2 text-slate-400" /> Nadawca
              </label>
              <input
                required
                type="text"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Imię i nazwisko / Firma"
                value={formData.sender}
                onChange={e => setFormData({ ...formData, sender: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center">
                <User className="w-4 h-4 mr-2 text-slate-400" /> Odbiorca
              </label>
              <input
                required
                type="text"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Imię i nazwisko odbiorcy"
                value={formData.recipient}
                onChange={e => setFormData({ ...formData, recipient: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center">
                <MapPin className="w-4 h-4 mr-2 text-slate-400" /> Adres Dostawy
              </label>
              <textarea
                required
                rows={2}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Ulica, numer, kod pocztowy, miasto"
                value={formData.address}
                onChange={e => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center">
                <Package className="w-4 h-4 mr-2 text-slate-400" /> Zawartość
              </label>
              <input
                required
                type="text"
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                placeholder="Co wysyłasz?"
                value={formData.contents}
                onChange={e => setFormData({ ...formData, contents: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Długość (cm)</label>
                <input
                  required
                  type="number"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none"
                  value={formData.length}
                  onChange={e => setFormData({ ...formData, length: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Szerokość (cm)</label>
                <input
                  required
                  type="number"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none"
                  value={formData.width}
                  onChange={e => setFormData({ ...formData, width: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Wysokość (cm)</label>
                <input
                  required
                  type="number"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none"
                  value={formData.height}
                  onChange={e => setFormData({ ...formData, height: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center">
                  <Scale className="w-3 h-3 mr-1" /> Waga (kg)
                </label>
                <input
                  required
                  type="number"
                  step="0.1"
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg outline-none"
                  value={formData.weight}
                  onChange={e => setFormData({ ...formData, weight: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 flex justify-end">
          <button
            type="submit"
            className="flex items-center space-x-2 bg-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-indigo-700 shadow-md hover:shadow-lg transition-all"
          >
            <span>Wygeneruj Etykietę</span>
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
};

export default ShipmentForm;
