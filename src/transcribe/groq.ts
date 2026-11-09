import fs from "node:fs";
import Groq from "groq-sdk";
import type { Transcriber, TranscriberLimits } from "./transcriber.js";

export interface GroqSegment {
  id?: number;
  start: number;
  end: number;
  text: string;
}

export interface GroqVerboseJsonResponse {
  language?: string;
  segments?: GroqSegment[];
}

export const GROQ_LIMITS: TranscriberLimits = {
  maxFileBytes: 24.5 * 1024 * 1024,
  segmentSeconds: 1200,
};

/**
 * Creates a transcriber backed by the Groq Audio Transcription API (whisper-large-v3-turbo by default).
 */
export function createGroqTranscriber(apiKey: string): Transcriber {
  return {
    logLabel: "Groq API",
    limits: GROQ_LIMITS,
    async transcribe(audioPath, options) {
      const groq = new Groq({ apiKey });
      const model =
        options?.model ||
        process.env["VSUB_GROQ_MODEL"] ||
        process.env["GROQ_MODEL"] ||
        "whisper-large-v3-turbo";

      if (options?.verbose) {
        const promptInfo = options.prompt ? ` (prompt: "${options.prompt.slice(0, 30)}...")` : "";
        console.log(
          `[Groq API] Requesting Whisper transcription [model: ${model}]: ${audioPath}${promptInfo}`,
        );
      }

      const response = await groq.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model,
        response_format: "verbose_json",
        ...(options?.prompt ? { prompt: options.prompt } : {}),
      });

      const rawResponse = response as unknown as GroqVerboseJsonResponse;
      return {
        segments: rawResponse.segments || [],
        language: rawResponse.language,
      };
    },
  };
}
