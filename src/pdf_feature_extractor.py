import os
import re
from pypdf import PdfReader

def get_pdf_features_config():
    """
    Reads the PDFs in 'train resorces' and extracts which pattern features are active.
    Returns a dictionary of patterns that were confirmed in the training resources.
    """
    resources_dir = os.path.join(os.path.dirname(__file__), "..", "train resorces")
    if not os.path.exists(resources_dir):
        # Fallback to local path just in case
        resources_dir = "train resorces"
        
    config = {
        # Candlesticks
        "hammer": False,
        "inverted_hammer": False,
        "shooting_star": False,
        "doji": False,
        "bullish_engulfing": False,
        "bearish_engulfing": False,
        "marubozu": False,
        # Chart patterns
        "double_top": False,
        "double_bottom": False,
        "channels": False,
        # SMC
        "bos_choch": False,
        "order_blocks": False,
        "mitigation_blocks": False,
        "premium_discount": False,
        "fvg": False,
        "liquidity_sweeps": False
    }
    
    if not os.path.exists(resources_dir):
        print("Warning: 'train resorces' folder not found. Using default features.")
        # Enable all by default as fallback
        return {k: True for k in config}
        
    print("Scanning 'train resorces' folder for strategy PDFs...")
    pdf_files = [f for f in os.listdir(resources_dir) if f.endswith(".pdf")]
    
    if not pdf_files:
        print("No PDF files found in 'train resorces'. Using default features.")
        return {k: True for k in config}
        
    for filename in pdf_files:
        path = os.path.join(resources_dir, filename)
        try:
            print(f"  * Parsing PDF: {filename}...")
            reader = PdfReader(path)
            text = ""
            # Extract first 30 pages to prevent memory/time blowup
            for page in reader.pages[:30]:
                t = page.extract_text()
                if t:
                    text += t + "\n"
            
            # Match keywords case-insensitive
            text_lower = text.lower()
            
            if "hammer" in text_lower:
                config["hammer"] = True
            if "inverted hammer" in text_lower or "shooting star" in text_lower:
                config["inverted_hammer"] = True
                config["shooting_star"] = True
            if "doji" in text_lower:
                config["doji"] = True
            if "engulfing" in text_lower:
                config["bullish_engulfing"] = True
                config["bearish_engulfing"] = True
            if "marubozu" in text_lower:
                config["marubozu"] = True
                
            if "double top" in text_lower or "head" in text_lower:
                config["double_top"] = True
            if "double bottom" in text_lower:
                config["double_bottom"] = True
            if "channel" in text_lower:
                config["channels"] = True
                
            if "structure" in text_lower or "bos" in text_lower or "character" in text_lower or "choch" in text_lower:
                config["bos_choch"] = True
            if "block" in text_lower or "supply" in text_lower or "demand" in text_lower:
                config["order_blocks"] = True
            if "mitigation" in text_lower or "breaker" in text_lower:
                config["mitigation_blocks"] = True
            if "premium" in text_lower or "discount" in text_lower or "equilibrium" in text_lower:
                config["premium_discount"] = True
            if "fvg" in text_lower or "value gap" in text_lower or "imbalance" in text_lower:
                config["fvg"] = True
            if "sweep" in text_lower or "liquidity" in text_lower:
                config["liquidity_sweeps"] = True
                
        except Exception as e:
            print(f"  Error reading {filename}: {e}")
            
    # Print what patterns were extracted
    active_patterns = [k.replace("_", " ").title() for k, v in config.items() if v]
    print(f"Extracted active PDF patterns: {', '.join(active_patterns)}")
    return config
