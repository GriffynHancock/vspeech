#!/usr/bin/env python3
"""
vectorspeech_corpus_helper.py
─────────────────────────────
Drop-in replacement for vectorspeech_engine_fixed.py when using a custom
corpus (URL directory or local .txt files).

Place this file in the same directory as vectorspeech_engine_fixed.py.
The Bun server calls it automatically when corpus_type != 'wikipedia'.

Extra argument injected by the server:
  --corpus-file PATH   Path to a pre-built corpus .txt file.
                       Skips all Wikipedia fetching; trains tokeniser
                       directly on this file.

All other arguments are identical to vectorspeech_engine_fixed.py.
"""

import sys
import os
import importlib.util
import argparse

# ── Load the original engine from same directory ──────────────
_here = os.path.dirname(os.path.abspath(__file__))
_engine_path = os.path.join(_here, 'vectorspeech_engine_fixed.py')

if not os.path.exists(_engine_path):
    print(f"ERROR: vectorspeech_engine_fixed.py not found at {_engine_path}")
    sys.exit(1)

spec = importlib.util.spec_from_file_location('vectorspeech_engine_fixed', _engine_path)
engine_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine_module)

VectorSpeechEngine = engine_module.VectorSpeechEngine


class CustomCorpusEngine(VectorSpeechEngine):
    """VectorSpeechEngine with build_corpus overridden to use a local file."""

    def __init__(self, corpus_file: str, **kwargs):
        super().__init__(**kwargs)
        self.corpus_file = corpus_file

    def load_index(self) -> bool:
        """Skip index loading — not needed for custom corpus."""
        self.page_index = []   # empty but non-None
        print(f"✓ Custom corpus mode — Wikipedia index not required")
        return True

    def build_corpus(self, page_specs) -> str:
        """Read pre-built corpus from file instead of fetching Wikipedia."""
        with open(self.corpus_file, 'r', encoding='utf-8') as f:
            corpus = f.read()
        words = len(corpus.split())
        chars = len(corpus)
        print(f"\n✓ Custom corpus loaded from: {self.corpus_file}")
        print(f"  Total words: {words:,}")
        print(f"  Total chars: {chars:,}")
        print(f"  Size       : {chars / 1024:.1f} KB")
        return corpus

    def select_pages_and_ranges(self, hash_value: bytes):
        """Return a dummy page spec — build_corpus ignores it anyway."""
        print(f"✓ Using custom corpus — skipping page selection")
        return [({'title': 'custom-corpus', 'revid': 0}, 0, 999999)]

    def send_message(self, message, seed_phrase, iteration, binary=False):
        print("=" * 70)
        print("SENDING MESSAGE (custom corpus)")
        print("=" * 70)
        hash_value = self.generate_hash_chain(seed_phrase, iteration)
        page_specs = self.select_pages_and_ranges(hash_value)
        corpus     = self.build_corpus(page_specs)
        model_file = self.train_tokenizer(corpus, iteration)
        token_ids  = self.encode_message(message, model_file)

        import time
        result = {
            "vector":         token_ids,
            "iteration":      iteration,
            "version":        self.version,
            "security_level": self.security_level,
            "message_length": len(message),
            "timestamp":      time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        print("\n" + "=" * 70)
        print("✓ MESSAGE ENCODED SUCCESSFULLY")
        print("=" * 70)
        return result

    def receive_message(self, vector, seed_phrase, iteration):
        print("=" * 70)
        print("RECEIVING MESSAGE (custom corpus)")
        print("=" * 70)
        hash_value = self.generate_hash_chain(seed_phrase, iteration)
        page_specs = self.select_pages_and_ranges(hash_value)
        corpus     = self.build_corpus(page_specs)
        model_file = self.train_tokenizer(corpus, iteration)
        message    = self.decode_message(vector, model_file)
        print("\n" + "=" * 70)
        print("✓ MESSAGE DECODED SUCCESSFULLY")
        print("=" * 70)
        print(f"\nDecoded message:\n{message}")
        return message


def main():
    # Pull --corpus-file before passing remaining args to the engine parser
    if '--corpus-file' not in sys.argv:
        print("ERROR: --corpus-file is required for the corpus helper")
        sys.exit(1)

    idx         = sys.argv.index('--corpus-file')
    corpus_file = sys.argv[idx + 1]
    remaining   = sys.argv[1:idx] + sys.argv[idx + 2:]

    # Parse the standard engine args from remaining
    import argparse, json
    from pathlib import Path

    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--send',    metavar='MESSAGE')
    action.add_argument('--receive', metavar='FILE')
    parser.add_argument('--seed',      required=True)
    parser.add_argument('--iteration', type=int, required=True)
    parser.add_argument('--version',  '-v', type=int, default=1)
    parser.add_argument('--security', '-s', choices=['low','medium','high'], default='medium')
    parser.add_argument('--output',  '-o')
    parser.add_argument('--binary',  action='store_true')
    args = parser.parse_args(remaining)

    engine = CustomCorpusEngine(
        corpus_file=corpus_file,
        version=args.version,
        security_level=args.security,
    )

    OUTPUT_DIR = Path('output')
    OUTPUT_DIR.mkdir(exist_ok=True)

    if args.send:
        result = engine.send_message(args.send, args.seed, args.iteration)
        out_path = args.output or OUTPUT_DIR / f"message_{args.iteration}.json"
        import json as _json
        with open(out_path, 'w') as f:
            _json.dump(result, f, indent=2)
        print(f"\n✓ JSON saved: {out_path}")

    elif args.receive:
        receive_path = Path(args.receive)
        import json as _json
        with open(receive_path) as f:
            data = _json.load(f)
        token_ids = data['vector']
        message   = engine.receive_message(token_ids, args.seed, args.iteration)
        print("\n" + "=" * 70)
        print(f"MESSAGE: {message}")
        print("=" * 70)


if __name__ == '__main__':
    main()
