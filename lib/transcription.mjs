/**
 * Transcription Provider Abstraction Layer
 *
 * Supports multiple transcription providers:
 * - assemblyai (default)
 * - ai-builders (private service)
 *
 * Configuration:
 * - Environment variables: TRANSCRIPTION_PROVIDER, TRANSCRIPTION_API_KEY
 * - Config file: ~/.config/claude-web/transcription.json
 *
 * Example config file:
 * {
 *   "provider": "assemblyai",
 *   "apiKey": "your-api-key"
 * }
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_FILE = join(homedir(), '.config', 'claude-web', 'transcription.json');

/**
 * Load configuration from file or environment
 */
function loadConfig() {
  let config = {
    provider: process.env.TRANSCRIPTION_PROVIDER || 'assemblyai',
    apiKey: process.env.TRANSCRIPTION_API_KEY || ''
  };

  // Override with config file if exists
  if (existsSync(CONFIG_FILE)) {
    try {
      const fileConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      if (fileConfig.provider) config.provider = fileConfig.provider;
      if (fileConfig.apiKey) config.apiKey = fileConfig.apiKey;
    } catch (err) {
      console.error('Failed to read transcription config:', err.message);
    }
  }

  return config;
}

/**
 * AssemblyAI transcription provider
 * https://www.assemblyai.com/docs/getting-started/transcribe-an-audio-file
 */
async function transcribeWithAssemblyAI(audioBuffer, apiKey) {
  // Step 1: Upload audio file
  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
    },
    body: audioBuffer
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`AssemblyAI upload failed: ${uploadResponse.status} - ${error}`);
  }

  const { upload_url } = await uploadResponse.json();

  // Step 2: Create transcription request
  const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: 'zh'  // Support Chinese, auto-detects if not specified
    })
  });

  if (!transcriptResponse.ok) {
    const error = await transcriptResponse.text();
    throw new Error(`AssemblyAI transcript request failed: ${transcriptResponse.status} - ${error}`);
  }

  const { id } = await transcriptResponse.json();

  // Step 3: Poll for result
  const maxAttempts = 60;  // ~30 seconds max
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 500));

    const pollingResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { 'Authorization': apiKey }
    });

    if (!pollingResponse.ok) {
      throw new Error(`AssemblyAI polling failed: ${pollingResponse.status}`);
    }

    const result = await pollingResponse.json();

    if (result.status === 'completed') {
      return result.text;
    } else if (result.status === 'error') {
      throw new Error(`AssemblyAI transcription error: ${result.error}`);
    }
    // Continue polling if status is 'queued' or 'processing'
  }

  throw new Error('AssemblyAI transcription timeout');
}

/**
 * AI Builders transcription provider (private service)
 */
async function transcribeWithAIBuilders(audioBuffer, token) {
  const API_URL = 'https://space.ai-builders.com/backend/v1/audio/transcriptions';

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: 'audio/webm' });
  formData.append('audio_file', blob, 'recording.webm');

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(`AI Builders API error: ${response.status}`);
  }

  const data = await response.json();
  return data.text;
}

/**
 * Transcribe audio using configured provider
 * @param {Buffer} audioBuffer - Audio data to transcribe
 * @returns {Promise<string>} - Transcribed text
 */
export async function transcribe(audioBuffer) {
  const config = loadConfig();

  if (!config.apiKey) {
    throw new Error(`Transcription API key not configured for provider: ${config.provider}. ` +
      `Set TRANSCRIPTION_API_KEY env var or create ${CONFIG_FILE}`);
  }

  switch (config.provider) {
    case 'assemblyai':
      return transcribeWithAssemblyAI(audioBuffer, config.apiKey);

    case 'ai-builders':
      return transcribeWithAIBuilders(audioBuffer, config.apiKey);

    default:
      throw new Error(`Unknown transcription provider: ${config.provider}. ` +
        `Supported: assemblyai, ai-builders`);
  }
}

/**
 * Get current provider name for display
 */
export function getProviderName() {
  const config = loadConfig();
  const names = {
    'assemblyai': 'AssemblyAI',
    'ai-builders': 'AI Builders'
  };
  return names[config.provider] || config.provider;
}