import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Increase payload size limit for high-res receipt images
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Enable CORS for cross-origin fetches (e.g. from Android WebViews or preview iframes)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static frontend files from workspace root
app.use(express.static(__dirname));

// Lazy-initialize Gemini AI Client
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// POST /api/extract-receipt
app.post('/api/extract-receipt', async (req, res) => {
  try {
    const { image, customOcrUrl } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'No image data provided.' });
    }

    const targetOcrUrl = customOcrUrl || process.env.PYTHON_OCR_URL;

    // IF Python EasyOCR custom endpoint is specified, forward request to it
    if (targetOcrUrl) {
      console.log('Routing receipt extraction to Python EasyOCR endpoint:', targetOcrUrl);
      try {
        const pythonRes = await fetch(targetOcrUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image })
        });

        if (!pythonRes.ok) {
          const errText = await pythonRes.text().catch(() => '');
          return res.status(500).json({
            error: `Python EasyOCR server returned HTTP ${pythonRes.status}: ${errText}`
          });
        }

        const pythonData = await pythonRes.json();
        return res.json(pythonData);
      } catch (pythonErr: any) {
        console.error('Failed contacting Python EasyOCR backend:', pythonErr);
        return res.status(500).json({
          error: `Could not connect to Python EasyOCR server at ${targetOcrUrl}. Check server status.`
        });
      }
    }

    // OTHERWISE, fallback to Gemini AI API if GEMINI_API_KEY is available
    let mimeType = 'image/jpeg';
    let base64Data = image;

    if (image.startsWith('data:')) {
      const parts = image.split(';base64,');
      const header = parts[0];
      mimeType = header.replace('data:', '');
      base64Data = parts[1];
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
      return res.status(400).json({
        error: 'No AI Key or EasyOCR API configured. Please enter GEMINI_API_KEY in platform settings OR set custom Python EasyOCR URL in settings.'
      });
    }

    const ai = getGeminiClient();

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: `Analyze this image carefully.
1. Determine if this image is a readable purchase receipt, tax invoice, store receipt, or transaction record.
2. IF the image is blank, dark, blurry, corrupt, or does NOT contain a readable receipt or tax invoice, set "isReceipt": false, "unreadableReason": "Image is blank, blurry, or not a readable receipt." and leave all other fields blank or 0.
3. IF it IS a readable receipt, extract the exact merchant name, total price/amount in AUD, transaction date, ABN, line item description, and tax category.
Do NOT invent, guess, or fabricate any data if it is not visible in the image.`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isReceipt: {
              type: Type.BOOLEAN,
              description: 'Set to true ONLY if image contains a readable receipt or invoice. False if blank or not a receipt.',
            },
            unreadableReason: {
              type: Type.STRING,
              description: 'Reason if isReceipt is false.',
            },
            description: {
              type: Type.STRING,
              description: 'Short descriptive title of the purchase extracted strictly from the receipt image.',
            },
            amount: {
              type: Type.NUMBER,
              description: 'Total transaction amount numeric value found on receipt (e.g. 89.50). Set to 0 if not visible.',
            },
            date: {
              type: Type.STRING,
              description: 'Transaction date in YYYY-MM-DD format if visible on receipt.',
            },
            merchant: {
              type: Type.STRING,
              description: 'Exact business or merchant store name found on receipt.',
            },
            abn: {
              type: Type.STRING,
              description: 'Australian Business Number (ABN) if present on receipt.',
            },
            category: {
              type: Type.STRING,
              description: 'Tax category from [work, vehicle, home, health, education, investment, donation, other].',
            },
            notes: {
              type: Type.STRING,
              description: 'Notes including GST amount or extra details visible on receipt.',
            },
          },
          required: ['isReceipt'],
        },
      },
    });

    const resultText = response.text;
    if (!resultText) {
      return res.status(500).json({ error: 'Gemini AI returned empty response.' });
    }

    let cleanJson = resultText.trim();
    if (cleanJson.includes('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    }

    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch {
      const match = cleanJson.match(/\{[\s\S]*\}/);
      if (match) {
        parsedData = JSON.parse(match[0]);
      } else {
        return res.status(500).json({ error: 'Could not parse JSON output from Gemini AI response.' });
      }
    }

    return res.json({ success: true, data: parsedData });
  } catch (error: any) {
    console.error('Receipt extraction error:', error);
    return res.status(500).json({
      error: error.message || 'Error processing receipt image.',
    });
  }
});

// Fallback to index.html for unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`DeducTrack AU Server running on http://localhost:${PORT}`);
});
