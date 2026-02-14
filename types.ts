
export interface Recording {
  id: string;
  blob: Blob;
  timestamp: Date;
  duration: number;
  peakLevel: number;
  dateStr: string;
  timeStr: string;
}

export interface RecorderConfig {
  threshold: number; // 0 to 1
  silenceDelay: number; // ms
  isActive: boolean;
}

/**
 * Added to fix errors in geminiService.ts and ShipmentForm.tsx
 */
export enum ShipmentStatus {
  PENDING = 'PENDING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
}

export interface AIAnalysisResult {
  category: string;
  suggestedDimensions: {
    length: number;
    width: number;
    height: number;
    weight: number;
  };
  estimatedValue: string;
  packagingAdvice: string;
  fragile: boolean;
}
