#!/usr/bin/env python3
"""
vectorspeech_engine_fixed.py - Fixed version with proper random walk through full dataset

Key fix: Iteration + seed determines which pages from the FULL 10,000-page dataset to use,
not just which pages from a fixed 100-page window.
"""

import argparse
import json
import hashlib
import random
import os
import sys
import time
import re
from pathlib import Path
from typing import List, Dict, Tuple, Optional

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

try:
    import sentencepiece as spm
except ImportError:
    print("ERROR: sentencepiece not installed. Run: pip install sentencepiece")
    sys.exit(1)

# Configuration
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
INDEX_FILE_TEMPLATE = "vital_articles_v{version}.json"
TEMP_DIR = Path("temp")
OUTPUT_DIR = Path("output")

# Security level presets
SECURITY_PRESETS = {
    "low": {"num_pages": 5, "words_per_page": 80, "word_range": 30},      # ~400 words total
    "medium": {"num_pages": 10, "words_per_page": 100, "word_range": 40},  # ~1000 words total
    "high": {"num_pages": 20, "words_per_page": 150, "word_range": 50}     # ~3000 words total
}

# Tokenizer settings
TOKENIZER_VOCAB_SIZE = 256  # Must be 256 for 8-bit encoding (0-255)
TOKENIZER_MODEL_TYPE = "bpe"  # BPE with small corpus = unique fragmentation per message


class VectorSpeechEngine:
    """Core engine for VectorSpeech cryptographic messaging"""
    
    def __init__(self, version: int = 1, security_level: str = "medium"):
        self.version = version
        self.security_level = security_level
        self.security_config = SECURITY_PRESETS[security_level]
        self.page_index = None
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'VectorSpeech/1.0 (Educational Crypto Project)'
        })
        
        # Create directories
        TEMP_DIR.mkdir(exist_ok=True)
        OUTPUT_DIR.mkdir(exist_ok=True)
    
    def load_index(self) -> bool:
        """Load Wikipedia Vital Articles index"""
        # Try demo file first
        index_file = "vital_articles_demo.json"
        if not os.path.exists(index_file):
            index_file = INDEX_FILE_TEMPLATE.format(version=self.version)
        
        if not os.path.exists(index_file):
            print(f"ERROR: Index file '{index_file}' not found")
            print(f"Build it first: python build_vital_index.py --fetch --version {self.version}")
            return False
        
        print(f"Loading index: {index_file}")
        with open(index_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        self.page_index = data["index"]
        metadata = data["metadata"]
        
        print(f"✓ Loaded {len(self.page_index)} pages")
        print(f"  Version: {metadata.get('version')}")
        print(f"  Snapshot: {metadata.get('snapshot_date')}")
        print(f"  Checksum: {metadata.get('checksum')[:16]}...")
        
        return True
    
    def generate_hash_chain(self, seed_phrase: str, iteration: int) -> bytes:
        """
        Generate the Nth hash in the chain
        
        Hash_0 = SHA256(seed_phrase)
        Hash_N = SHA256(seed_phrase + Hash_{N-1})
        """
        print(f"Generating hash chain for iteration {iteration}...")
        
        current_hash = hashlib.sha256(seed_phrase.encode('utf-8')).digest()
        
        for i in range(iteration):
            combined = seed_phrase.encode('utf-8') + current_hash
            current_hash = hashlib.sha256(combined).digest()
        
        hash_hex = current_hash.hex()[:16]
        print(f"✓ Hash generated: {hash_hex}...")
        
        return current_hash
    
    def select_pages_and_ranges(self, hash_value: bytes) -> List[Tuple[Dict, int, int]]:
        """
        Deterministically select pages and word ranges based on hash
        
        FIXED: Now selects from the FULL dataset using hash, not a fixed window
        
        Returns: List of (page_dict, word_start, word_count) tuples
        """
        print(f"Selecting pages using security level: {self.security_level}")
        
        # Seed RNG with full hash - this is what makes each iteration different
        # The hash already incorporates the iteration number via the hash chain
        rng_seed = int.from_bytes(hash_value, byteorder='big')
        rng = random.Random(rng_seed)
        
        num_pages = self.security_config["num_pages"]
        words_per_page = self.security_config["words_per_page"]
        word_range = self.security_config["word_range"]
        
        # FIXED: Select random pages from FULL index, not a window
        # This creates a random walk through the entire dataset
        selected_pages = rng.sample(self.page_index, num_pages)
        
        # For debugging: show the distribution of selected page indices
        selected_indices = [self.page_index.index(page) for page in selected_pages]
        min_idx = min(selected_indices)
        max_idx = max(selected_indices)
        print(f"  Selecting {num_pages} pages from full dataset ({len(self.page_index)} total)")
        print(f"  Page index range: {min_idx} to {max_idx} (span: {max_idx - min_idx})")
        
        # Determine word ranges for each page
        page_specs = []
        for page in selected_pages:
            # Random starting position (0-2000 words into page)
            word_start = rng.randint(0, 2000)
            
            # Random word count around target (±word_range)
            word_count = rng.randint(
                words_per_page - word_range,
                words_per_page + word_range
            )
            
            page_specs.append((page, word_start, word_count))
        
        print(f"✓ Selected {num_pages} pages with word ranges")
        
        # Show first 3 selections
        for i, (page, start, count) in enumerate(page_specs[:3]):
            page_idx = self.page_index.index(page)
            print(f"  [{i}] #{page_idx:4d} {page['title'][:35]:35s} words {start}-{start+count}")
        if len(page_specs) > 3:
            print(f"  ... and {len(page_specs) - 3} more")
        
        return page_specs
    
    def fetch_wikipedia_content(self, page: Dict) -> str:
        """Fetch content for a specific Wikipedia page revision"""
        params = {
            "action": "query",
            "format": "json",
            "prop": "revisions",
            "revids": page["revid"],
            "rvprop": "content",
            "rvslots": "main"
        }
        
        try:
            response = self.session.get(WIKIPEDIA_API, params=params, timeout=30)
            response.raise_for_status()
            data = response.json()
            
            pages_data = data["query"]["pages"]
            page_data = list(pages_data.values())[0]
            
            if "revisions" not in page_data:
                return ""
            
            content = page_data["revisions"][0]["slots"]["main"]["*"]
            
            # Clean Wikipedia markup (basic cleaning)
            content = self.clean_wikipedia_markup(content)
            
            return content
            
        except Exception as e:
            print(f"WARNING: Failed to fetch {page['title']}: {e}")
            return ""
    
    def clean_wikipedia_markup(self, text: str) -> str:
        """Remove Wikipedia markup to get clean text"""
        # Remove templates {{...}}
        text = re.sub(r'\{\{[^}]+\}\}', '', text)
        
        # Remove references <ref>...</ref>
        text = re.sub(r'<ref[^>]*>.*?</ref>', '', text, flags=re.DOTALL)
        text = re.sub(r'<ref[^>]*/>', '', text)
        
        # Remove file/image links
        text = re.sub(r'\[\[File:.*?\]\]', '', text, flags=re.IGNORECASE)
        text = re.sub(r'\[\[Image:.*?\]\]', '', text, flags=re.IGNORECASE)
        
        # Convert wiki links [[Link|Text]] to Text
        text = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', text)
        
        # Remove section headers
        text = re.sub(r'={2,}[^=]+=={2,}', '', text)
        
        # Remove HTML comments
        text = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL)
        
        # Remove remaining HTML tags
        text = re.sub(r'<[^>]+>', '', text)
        
        # Remove multiple whitespace
        text = re.sub(r'\s+', ' ', text)
        
        return text.strip()
    
    def extract_word_range(self, text: str, start_word: int, word_count: int) -> str:
        """Extract specific word range from text"""
        words = text.split()
        
        # Handle out of bounds
        start = min(start_word, max(0, len(words) - 1))
        end = min(start + word_count, len(words))
        
        return " ".join(words[start:end])
    
    def build_corpus(self, page_specs: List[Tuple[Dict, int, int]]) -> str:
        """
        Fetch Wikipedia content and build training corpus
        
        This is the key security component - the corpus is deterministically
        generated but unpredictable without the seed phrase
        """
        print(f"\nBuilding corpus from {len(page_specs)} pages...")
        
        corpus_parts = []
        
        for i, (page, word_start, word_count) in enumerate(page_specs):
            print(f"  Fetching [{i+1}/{len(page_specs)}] {page['title'][:50]}...")
            
            # Fetch full page content
            content = self.fetch_wikipedia_content(page)
            
            if not content:
                print(f"    WARNING: Empty content, skipping")
                continue
            
            # Extract word range
            excerpt = self.extract_word_range(content, word_start, word_count)
            
            if excerpt:
                corpus_parts.append(excerpt)
                print(f"    ✓ Extracted {len(excerpt.split())} words")
            
            # Rate limiting
            time.sleep(0.1)
        
        corpus = "\n\n".join(corpus_parts)
        
        total_words = len(corpus.split())
        total_chars = len(corpus)
        
        print(f"\n✓ Corpus built:")
        print(f"  Total words: {total_words:,}")
        print(f"  Total chars: {total_chars:,}")
        print(f"  Size: {total_chars / 1024:.1f} KB")
        
        return corpus
    
    def train_tokenizer(self, corpus: str, iteration: int) -> str:
        """
        Train SentencePiece tokenizer on corpus
        
        Returns path to model file
        """
        print("\nTraining tokenizer...")
        
        # Save corpus to temp file
        corpus_file = TEMP_DIR / f"corpus_{iteration}.txt"
        with open(corpus_file, "w", encoding="utf-8") as f:
            f.write(corpus)
        
        # TESTING: Also save a copy for inspection
        debug_corpus_file = OUTPUT_DIR / f"corpus_{iteration}_debug.txt"
        with open(debug_corpus_file, "w", encoding="utf-8") as f:
            f.write(corpus)
        print(f"  [DEBUG] Corpus saved to {debug_corpus_file} for inspection")
        
        # Model files
        model_prefix = TEMP_DIR / f"spm_{iteration}"
        model_file = f"{model_prefix}.model"
        
        # Train SentencePiece
        train_args = (
            f"--input={corpus_file} "
            f"--model_prefix={model_prefix} "
            f"--vocab_size={TOKENIZER_VOCAB_SIZE} "
            f"--model_type={TOKENIZER_MODEL_TYPE} "
            f"--character_coverage=1.0 "
            f"--unk_id=0 --bos_id=-1 --eos_id=-1"
        )
        
        print(f"  Vocab size: {TOKENIZER_VOCAB_SIZE}")
        print(f"  Model type: {TOKENIZER_MODEL_TYPE}")
        
        try:
            spm.SentencePieceTrainer.Train(train_args)
            print(f"✓ Tokenizer trained: {model_file}")
            return str(model_file)
        except Exception as e:
            print(f"ERROR: Training failed: {e}")
            raise
    
    def encode_message(self, message: str, model_file: str) -> List[int]:
        """Encode message to token IDs using trained tokenizer"""
        print("\nEncoding message...")
        
        sp = spm.SentencePieceProcessor()
        sp.Load(model_file)
        
        ids = sp.EncodeAsIds(message)
        
        print(f"✓ Encoded to {len(ids)} tokens")
        print(f"  Message length: {len(message)} chars")
        print(f"  Vector: {ids[:20]}{'...' if len(ids) > 20 else ''}")
        
        return ids
    
    def decode_message(self, token_ids: List[int], model_file: str) -> str:
        """Decode token IDs to message using trained tokenizer"""
        print("\nDecoding message...")
        
        sp = spm.SentencePieceProcessor()
        sp.Load(model_file)
        
        message = sp.DecodeIds(token_ids)
        
        print(f"✓ Decoded {len(token_ids)} tokens")
        print(f"  Message length: {len(message)} chars")
        
        return message
    
    def send_message(self, message: str, seed_phrase: str, iteration: int) -> Dict:
        """
        Complete send workflow: hash → select → fetch → train → encode
        
        Returns: Dictionary with vector and metadata
        """
        print("=" * 70)
        print("SENDING MESSAGE")
        print("=" * 70)
        
        # Load index if not already loaded
        if self.page_index is None:
            if not self.load_index():
                raise RuntimeError("Failed to load index")
        
        # Generate hash for this iteration
        hash_value = self.generate_hash_chain(seed_phrase, iteration)
        
        # Select pages and word ranges
        page_specs = self.select_pages_and_ranges(hash_value)
        
        # Build corpus
        corpus = self.build_corpus(page_specs)
        
        # Train tokenizer
        model_file = self.train_tokenizer(corpus, iteration)
        
        # Encode message
        token_ids = self.encode_message(message, model_file)
        
        # Prepare output
        result = {
            "vector": token_ids,
            "iteration": iteration,
            "version": self.version,
            "security_level": self.security_level,
            "message_length": len(message),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        
        print("\n" + "=" * 70)
        print("✓ MESSAGE ENCODED SUCCESSFULLY")
        print("=" * 70)
        
        return result
    
    def receive_message(self, vector: List[int], seed_phrase: str, iteration: int) -> str:
        """
        Complete receive workflow: hash → select → fetch → train → decode
        
        Returns: Decoded message string
        """
        print("=" * 70)
        print("RECEIVING MESSAGE")
        print("=" * 70)
        
        # Load index if not already loaded
        if self.page_index is None:
            if not self.load_index():
                raise RuntimeError("Failed to load index")
        
        # Generate hash for this iteration
        hash_value = self.generate_hash_chain(seed_phrase, iteration)
        
        # Select pages and word ranges (same as sender!)
        page_specs = self.select_pages_and_ranges(hash_value)
        
        # Build corpus (same as sender!)
        corpus = self.build_corpus(page_specs)
        
        # Train tokenizer (same as sender!)
        model_file = self.train_tokenizer(corpus, iteration)
        
        # Decode message
        message = self.decode_message(vector, model_file)
        
        print("\n" + "=" * 70)
        print("✓ MESSAGE DECODED SUCCESSFULLY")
        print("=" * 70)
        print(f"\nDecoded message:\n{message}")
        
        return message


def main():
    parser = argparse.ArgumentParser(
        description="VectorSpeech Engine - Fixed version with full dataset random walk",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Send a message
  python vectorspeech_engine_fixed.py --send "Hello Bob!" --seed "correct horse" --iteration 1
  
  # Receive a message
  python vectorspeech_engine_fixed.py --receive output/message_1.json --seed "correct horse" --iteration 1
  
  # Send with high security
  python vectorspeech_engine_fixed.py --send "Secret message" --seed "my secret" --iteration 5 --security high
  
  # Use different version
  python vectorspeech_engine_fixed.py --send "Hello" --seed "test" --iteration 1 --version 5
        """
    )
    
    # Action group
    action_group = parser.add_mutually_exclusive_group(required=True)
    action_group.add_argument("--send", metavar="MESSAGE", 
                             help="Send a message (encode)")
    action_group.add_argument("--receive", metavar="FILE",
                             help="Receive a message (decode from JSON file)")
    
    # Required parameters
    parser.add_argument("--seed", required=True,
                       help="Seed phrase (shared secret)")
    parser.add_argument("--iteration", type=int, required=True,
                       help="Iteration number (must match on both sides)")
    
    # Optional parameters
    parser.add_argument("--version", "-v", type=int, default=1,
                       help="Wikipedia index version (1-100, default: 1)")
    parser.add_argument("--security", "-s", 
                       choices=["low", "medium", "high"],
                       default="medium",
                       help="Security level (default: medium)")
    parser.add_argument("--output", "-o",
                       help="Output file for encoded message (default: output/message_{iteration}.json)")
    
    args = parser.parse_args()
    
    try:
        # Create engine
        engine = VectorSpeechEngine(
            version=args.version,
            security_level=args.security
        )
        
        if args.send:
            # Send mode
            result = engine.send_message(args.send, args.seed, args.iteration)
            
            # Save to file
            output_file = args.output or OUTPUT_DIR / f"message_{args.iteration}.json"
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
            
            print(f"\n✓ Message saved to: {output_file}")
            print(f"\nTo decode, recipient should run:")
            print(f'  python vectorspeech_engine_fixed.py --receive {output_file} --seed "{args.seed}" --iteration {args.iteration}')
        
        elif args.receive:
            # Receive mode
            with open(args.receive, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            vector = data["vector"]
            
            # Verify parameters match
            if data.get("version") and data["version"] != args.version:
                print(f"WARNING: Version mismatch (file: {data['version']}, args: {args.version})")
            if data.get("security_level") and data["security_level"] != args.security:
                print(f"WARNING: Security level mismatch (file: {data['security_level']}, args: {args.security})")
            
            message = engine.receive_message(vector, args.seed, args.iteration)
            
            print("\n" + "=" * 70)
            print(f"MESSAGE: {message}")
            print("=" * 70)
    
    except KeyboardInterrupt:
        print("\n\nInterrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
    
    
    
    
    # Example - python3 Vspeech_new.py --send "This is the message, i hope that it finds you well. This is the kind of thing that I would send to an individual. Is that OK? We need to meet at metro station at 3:30PM, please do not bring your phone. We will exchange things printed and written on paper, and then we will leave going opposite directions. Come up to me and tell me 'The Orange is Orange, the Purple is Purple'. I won't speak to you, but I will give you a piece of paper with that same phrase written on it. I will then touch my knee and you will hand me the paper with the QR etc. on it. I will leave first then you. If any of these details is off in ANY way, you are to leave and go home. Don't do anything weird, just turn straight around and walk home. This is a long game, not all meetings will be successful." --seed "Hiranya" --iteration 155 --binary
