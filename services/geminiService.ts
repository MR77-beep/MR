
import { GoogleGenAI, Type } from "@google/genai";
import { AIAnalysisResult } from "../types";

// Always use new GoogleGenAI({ apiKey: process.env.API_KEY })
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const analyzeParcelImage = async (base64Image: string): Promise<AIAnalysisResult> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
        { text: "Analyze this item for shipping. Identify what it is, suggest dimensions (cm) and weight (kg), estimate value in PLN, give packaging advice, and flag if it is fragile. Respond in JSON format." }
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING },
          suggestedDimensions: {
            type: Type.OBJECT,
            properties: {
              length: { type: Type.NUMBER },
              width: { type: Type.NUMBER },
              height: { type: Type.NUMBER },
              weight: { type: Type.NUMBER }
            }
          },
          estimatedValue: { type: Type.STRING },
          packagingAdvice: { type: Type.STRING },
          fragile: { type: Type.BOOLEAN }
        },
        required: ["category", "suggestedDimensions", "estimatedValue", "packagingAdvice", "fragile"]
      }
    }
  });

  // response.text is a property, not a method.
  return JSON.parse(response.text || '{}') as AIAnalysisResult;
};

export const getQuickSummary = async (shipments: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Please summarize these recent shipments and suggest any logistics improvements: ${shipments}`,
    config: {
      systemInstruction: "You are a logistics expert assistant for a Polish shipping app called 'Nadawanie 2.0'. Keep your response concise and professional in Polish."
    }
  });
  // response.text is a property.
  return response.text || '';
};

// Audio helper functions as requested
export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
