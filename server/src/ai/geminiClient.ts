import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const apiKey = process.env.GEMINI_API_KEY || '';

if (!apiKey || apiKey === 'your-gemini-api-key') {
  console.warn('[Gemini] Warning: GEMINI_API_KEY is not set or using placeholder.');
}

export const genAI = new GoogleGenerativeAI(apiKey);

/**
 * Returns a generative model configured for JSON output
 */
export function getGeminiModel(modelName: string = 'gemini-2.5-flash', systemInstruction?: string) {
  return genAI.getGenerativeModel({
    model: modelName,
    ...(systemInstruction ? { systemInstruction } : {}),
  });
}
