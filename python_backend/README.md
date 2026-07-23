# Free Self-Hosted EasyOCR + Python Backend API for DeducTrack AU

This Python backend server provides free, high-accuracy receipt scanning using **EasyOCR** and **OpenCV**.

## Features
- **EasyOCR Deep Learning Engine**: Handles custom fonts, phone photos, tilted receipts, and thermal printer text.
- **Australian Tax Rules**: Detects ABN (Australian Business Number), Total AUD Amount, Merchant Name, Date, and Tax Deduction Category.
- **Blank Image Guard**: Automatically flags blank, dark, or unreadable photos.

## Hosting Instructions (Free Tier)

### Option A: Render.com (Free Web Service)
1. Fork or push this repository to GitHub.
2. Log into [Render.com](https://render.com) and click **New > Web Service**.
3. Connect your GitHub repository and set the Root Directory to `python_backend`.
4. Build Command: `pip install -r requirements.txt`
5. Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
6. Once deployed, copy your Render API URL (e.g., `https://my-easyocr-app.onrender.com/api/extract-receipt`).
7. Paste this URL into the DeducTrack AU settings or pass it via `PYTHON_OCR_URL`.

### Option B: Hugging Face Spaces (Free Docker Space)
1. Go to [Hugging Face Spaces](https://huggingface.co/spaces) and click **Create new Space**.
2. Select **Docker** as the SDK.
3. Upload the files in `python_backend/` (`app.py`, `requirements.txt`, `Dockerfile`).
4. Copy the public space URL (e.g. `https://username-space-name.hf.space/api/extract-receipt`).

---

## Local Usage
```bash
cd python_backend
pip install -r requirements.txt
python app.py
```
Server runs locally at `http://localhost:8000`.
