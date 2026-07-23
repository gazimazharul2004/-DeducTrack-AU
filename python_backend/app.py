import base64
import re
import io
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import cv2
import easyocr

app = FastAPI(title="EasyOCR Receipt Scanner API")

# Enable CORS for frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize EasyOCR reader (English)
reader = easyocr.Reader(['en'], gpu=False)

class ReceiptRequest(BaseModel):
    image: str

def parse_receipt_text(ocr_results) -> Dict[str, Any]:
    lines = [res[1].strip() for res in ocr_results if res[1].strip()]
    if not lines:
        return {
            "isReceipt": False,
            "unreadableReason": "Blank image or no text detected by EasyOCR."
        }

    full_text = " \n ".join(lines)
    text_upper = full_text.upper()

    # 1. ABN Detection (11-digit Australian Business Number)
    abn_match = re.search(r'\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b', full_text)
    abn = abn_match.group(0) if abn_match else ""

    # 2. Date Extraction (e.g. 23/07/2026, 2026-07-23, 23 Jul 2026)
    date_match = re.search(r'\b(\d{1,2}[\/\.-]\d{1,2}[\/\.-]\d{2,4}|\d{4}[\/\.-]\d{1,2}[\/\.-]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b', full_text, re.IGNORECASE)
    date_str = date_match.group(0) if date_match else ""

    # 3. Total Amount Extraction
    # Search for lines containing TOTAL, AMOUNT, BALANCE, NET, AUD
    amount = 0.0
    all_prices = []
    
    for res in ocr_results:
        text = res[1]
        matches = re.findall(r'\$?\s?(\d+\.\d{2})\b', text)
        for m in matches:
            try:
                val = float(m)
                all_prices.append((val, text.upper()))
            except ValueError:
                pass

    total_candidates = [p[0] for p in all_prices if "TOTAL" in p[1] or "BAL" in p[1] or "DUE" in p[1] or "AUD" in p[1] or "AMOUNT" in p[1]]
    if total_candidates:
        amount = max(total_candidates)
    elif all_prices:
        # Pick highest price on receipt if no explicit TOTAL keyword
        amount = max([p[0] for p in all_prices])

    # 4. Merchant Name Extraction (First 1-3 prominent header lines)
    merchant = ""
    ignore_words = ["TAX INVOICE", "RECEIPT", "WELCOME", "DUPLICATE", "COPY", "TAX", "INVOICE", "ABN"]
    for line in lines[:5]:
        line_clean = re.sub(r'[^A-Za-z0-9\s&]', '', line).strip()
        if len(line_clean) > 2 and not any(w in line_clean.upper() for w in ignore_words):
            merchant = line_clean
            break

    if not merchant and lines:
        merchant = lines[0]

    # 5. Category Categorization
    category = "work"
    desc = f"Purchase from {merchant}" if merchant else "Scanned receipt expense"
    
    if any(k in text_upper for k in ["STATIONERY", "OFFICE", "PAPER", "SOFTWARE", "DESK", "COMPUTER", "CABLE", "TECH"]):
        category = "work"
        desc = "Office supplies & work equipment"
    elif any(k in text_upper for k in ["FUEL", "PETROL", "DIESEL", "PARKING", "TOLL", "7-ELEVEN", "SHELL", "AMPOL", "BP"]):
        category = "vehicle"
        desc = "Work travel fuel / vehicle expense"
    elif any(k in text_upper for k in ["BUNNINGS", "HARDWARE", "TOOL", "PLUMBING", "PAINT", "BUILD"]):
        category = "home"
        desc = "Home office maintenance / tools"
    elif any(k in text_upper for k in ["CHEMIST", "PHARMACY", "HEALTH", "MEDICAL", "FIRST AID"]):
        category = "health"
        desc = "Workplace first aid / health supplies"
    elif any(k in text_upper for k in ["COURSE", "TRAINING", "BOOK", "SEMINAR", "TUITION"]):
        category = "education"
        desc = "Professional development & training"
    elif any(k in text_upper for k in ["DONATION", "CHARITY", "GIFT", "RECIPIENT"]):
        category = "donation"
        desc = "Deductible Gift Recipient donation"

    # 6. Check if valid receipt
    is_receipt = bool(amount > 0 or abn or (merchant and len(lines) >= 3))

    return {
        "isReceipt": is_receipt,
        "unreadableReason": "" if is_receipt else "Image does not appear to contain a readable receipt.",
        "merchant": merchant,
        "amount": round(amount, 2),
        "date": date_str,
        "abn": abn,
        "category": category,
        "description": desc,
        "notes": f"EasyOCR extracted {len(lines)} lines of text."
    }

@app.get("/")
def health_check():
    return {"status": "ok", "service": "EasyOCR Receipt Scanner Python Server"}

@app.post("/api/extract-receipt")
@app.post("/extract")
def extract_receipt(req: ReceiptRequest):
    try:
        image_str = req.image
        if image_str.startswith("data:"):
            image_str = image_str.split(";base64,")[1]
            
        img_bytes = base64.b64decode(image_str)
        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if img is None:
            raise HTTPException(status_code=400, detail="Invalid image payload.")

        # Check if image is blank / solid color
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        if np.std(gray) < 5:  # Standard deviation threshold for blank image
            return {
                "success": True,
                "data": {
                    "isReceipt": False,
                    "unreadableReason": "Image is blank or completely dark."
                }
            }

        # Run EasyOCR
        ocr_results = reader.readtext(img)
        parsed_data = parse_receipt_text(ocr_results)

        return {
            "success": True,
            "data": parsed_data
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
