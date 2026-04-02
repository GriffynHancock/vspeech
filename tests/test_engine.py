#!/usr/bin/env python3
"""
tests/test_engine.py
Unit tests for vectorspeech_engine_fixed.py

Run:  pytest tests/test_engine.py -v
      # or from project root:
      python3 -m pytest tests/test_engine.py -v
"""

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ─── Load engine module ───────────────────────────────────────────
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import importlib.util
_spec = importlib.util.spec_from_file_location(
    'vectorspeech_engine_fixed',
    ROOT / 'vectorspeech_engine_fixed.py',
)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore
_spec.loader.exec_module(_mod)                 # type: ignore
VectorSpeechEngine = _mod.VectorSpeechEngine
SECURITY_PRESETS   = _mod.SECURITY_PRESETS

# ─── Fixtures ────────────────────────────────────────────────────
DEMO_INDEX = ROOT / 'vital_articles_demo.json'


def load_demo_index() -> list:
    if not DEMO_INDEX.exists():
        pytest.skip(f"Demo index not found: {DEMO_INDEX}")
    with open(DEMO_INDEX) as f:
        return json.load(f)['index']


# ═════════════════════════════════════════════════════════════════
# Hash-chain tests
# ═════════════════════════════════════════════════════════════════

class TestHashChain:
    def test_iteration_0_equals_sha256_of_seed(self):
        """Iteration 0 must equal SHA256(seed_phrase)."""
        engine = VectorSpeechEngine(version=1, security_level='low')
        result = engine.generate_hash_chain('hello', 0)
        expected = hashlib.sha256('hello'.encode()).digest()
        assert result == expected

    def test_deterministic_same_inputs(self):
        """Same seed + iteration always produces identical hash."""
        engine = VectorSpeechEngine(version=1, security_level='low')
        h1 = engine.generate_hash_chain('my_secret_key', 42)
        h2 = engine.generate_hash_chain('my_secret_key', 42)
        assert h1 == h2

    def test_different_seeds_produce_different_hashes(self):
        engine = VectorSpeechEngine(version=1, security_level='low')
        h1 = engine.generate_hash_chain('alice_seed', 5)
        h2 = engine.generate_hash_chain('bob_seed', 5)
        assert h1 != h2

    def test_different_iterations_produce_different_hashes(self):
        engine = VectorSpeechEngine(version=1, security_level='low')
        hashes = {engine.generate_hash_chain('key', i).hex() for i in range(20)}
        assert len(hashes) == 20, "All 20 iterations must yield unique hashes"

    def test_hash_is_32_bytes(self):
        engine = VectorSpeechEngine(version=1, security_level='low')
        h = engine.generate_hash_chain('test', 3)
        assert len(h) == 32

    def test_forward_secrecy_no_back_computation(self):
        """H_N cannot be used to derive H_{N-1} (one-way chain)."""
        engine = VectorSpeechEngine(version=1, security_level='low')
        seed = 'forward_secrecy_test'
        h5 = engine.generate_hash_chain(seed, 5)
        h4 = engine.generate_hash_chain(seed, 4)
        # Verifying H_5 doesn't trivially equal SHA256(H_4)
        assert hashlib.sha256(h4).digest() != h5  # chain includes seed


# ═════════════════════════════════════════════════════════════════
# Page-selection tests
# ═════════════════════════════════════════════════════════════════

class TestPageSelection:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.index = load_demo_index()

    def _engine(self, level='medium'):
        e = VectorSpeechEngine(version=1, security_level=level)
        e.page_index = self.index
        return e

    def test_selection_is_deterministic(self):
        h = hashlib.sha256(b'test_seed').digest()
        e = self._engine()
        pages1 = [p[0]['title'] for p in e.select_pages_and_ranges(h)]
        pages2 = [p[0]['title'] for p in e.select_pages_and_ranges(h)]
        assert pages1 == pages2

    def test_different_hashes_different_pages(self):
        h1 = hashlib.sha256(b'alice').digest()
        h2 = hashlib.sha256(b'bob').digest()
        e = self._engine()
        p1 = {p[0]['title'] for p in e.select_pages_and_ranges(h1)}
        p2 = {p[0]['title'] for p in e.select_pages_and_ranges(h2)}
        # Different seeds → at least partly different selection
        assert p1 != p2

    @pytest.mark.parametrize('level,expected', [
        ('low', 5), ('medium', 10), ('high', 20)
    ])
    def test_num_pages_matches_security_level(self, level, expected):
        h = hashlib.sha256(b'test').digest()
        e = self._engine(level)
        pages = e.select_pages_and_ranges(h)
        assert len(pages) == expected

    def test_word_ranges_are_positive(self):
        h = hashlib.sha256(b'ranges').digest()
        e = self._engine('low')
        for _, word_start, word_count in e.select_pages_and_ranges(h):
            assert word_start >= 0
            assert word_count > 0

    def test_pages_come_from_index(self):
        h = hashlib.sha256(b'membership').digest()
        e = self._engine()
        titles_in_index = {p['title'] for p in self.index}
        for page, _, _ in e.select_pages_and_ranges(h):
            assert page['title'] in titles_in_index


# ═════════════════════════════════════════════════════════════════
# Tokenizer encode/decode round-trip
# ═════════════════════════════════════════════════════════════════

class TestTokenizerRoundTrip:
    CORPUS = (
        "The quick brown fox jumps over the lazy dog. "
        "Wikipedia is a free-content online encyclopedia. "
        "Cryptography protects information from unauthorized access. "
    ) * 60  # ~3 KB — enough for SentencePiece vocab

    def test_encode_returns_list_of_ints(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            e = VectorSpeechEngine(version=1, security_level='low')
            # Patch TEMP_DIR
            original = _mod.TEMP_DIR
            _mod.TEMP_DIR = Path(tmpdir)
            try:
                model = e.train_tokenizer(self.CORPUS, iteration=9001)
                ids = e.encode_message("hello world", model)
                assert isinstance(ids, list)
                assert all(isinstance(i, int) for i in ids)
                assert len(ids) > 0
            finally:
                _mod.TEMP_DIR = original

    def test_roundtrip_exact(self):
        messages = [
            "Hello, World!",
            "Meet me at the station at 3:30 PM.",
            "Short.",
            "This is a longer message with more context and detail.",
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            e = VectorSpeechEngine(version=1, security_level='low')
            original = _mod.TEMP_DIR
            _mod.TEMP_DIR = Path(tmpdir)
            try:
                model = e.train_tokenizer(self.CORPUS, iteration=9002)
                for msg in messages:
                    ids = e.encode_message(msg, model)
                    decoded = e.decode_message(ids, model)
                    assert decoded == msg, f"Round-trip failed: {repr(msg)} → {ids} → {repr(decoded)}"
            finally:
                _mod.TEMP_DIR = original

    def test_different_corpus_different_encoding(self):
        """Same message, different corpus → different token IDs."""
        corpus_a = ("alpha beta gamma delta epsilon " * 80)
        corpus_b = ("zeta eta theta iota kappa lambda " * 80)
        with tempfile.TemporaryDirectory() as tmpdir:
            e = VectorSpeechEngine(version=1, security_level='low')
            original = _mod.TEMP_DIR
            _mod.TEMP_DIR = Path(tmpdir)
            try:
                model_a = e.train_tokenizer(corpus_a, iteration=9010)
                model_b = e.train_tokenizer(corpus_b, iteration=9011)
                ids_a = e.encode_message("test", model_a)
                ids_b = e.encode_message("test", model_b)
                assert ids_a != ids_b, "Different corpora must produce different encodings"
            finally:
                _mod.TEMP_DIR = original


# ═════════════════════════════════════════════════════════════════
# Word extraction
# ═════════════════════════════════════════════════════════════════

class TestWordExtraction:
    def test_extract_correct_count(self):
        e = VectorSpeechEngine(version=1, security_level='low')
        text = " ".join(f"word{i}" for i in range(500))
        excerpt = e.extract_word_range(text, 0, 100)
        assert len(excerpt.split()) == 100

    def test_extract_handles_short_text(self):
        e = VectorSpeechEngine(version=1, security_level='low')
        text = "only five words here"
        excerpt = e.extract_word_range(text, 0, 1000)
        assert excerpt == text

    def test_extract_offset(self):
        e = VectorSpeechEngine(version=1, security_level='low')
        text = " ".join(f"w{i}" for i in range(100))
        excerpt = e.extract_word_range(text, 50, 10)
        words = excerpt.split()
        assert words[0] == 'w50'
        assert len(words) == 10


# ═════════════════════════════════════════════════════════════════
# Security constraints
# ═════════════════════════════════════════════════════════════════

class TestSecurityConstraints:
    def test_vocab_size_is_256(self):
        """Tokeniser vocab must be 256 to allow 8-bit encoding."""
        assert _mod.TOKENIZER_VOCAB_SIZE == 256

    def test_security_presets_exist(self):
        for level in ('low', 'medium', 'high'):
            assert level in SECURITY_PRESETS
            p = SECURITY_PRESETS[level]
            assert 'num_pages' in p
            assert 'words_per_page' in p
            assert p['num_pages'] > 0
            assert p['words_per_page'] > 0

    def test_security_levels_ordered(self):
        """High security must sample more pages than low."""
        assert SECURITY_PRESETS['high']['num_pages'] > SECURITY_PRESETS['medium']['num_pages']
        assert SECURITY_PRESETS['medium']['num_pages'] > SECURITY_PRESETS['low']['num_pages']

    def test_clean_wikipedia_markup_strips_templates(self):
        e = VectorSpeechEngine(version=1, security_level='low')
        raw = "Before {{some template}} after"
        cleaned = e.clean_wikipedia_markup(raw)
        assert '{{' not in cleaned
        assert 'Before' in cleaned
        assert 'after' in cleaned

    def test_clean_wikipedia_markup_strips_refs(self):
        e = VectorSpeechEngine(version=1, security_level='low')
        raw = 'Fact.<ref name="x">Source info</ref> More.'
        cleaned = e.clean_wikipedia_markup(raw)
        assert '<ref' not in cleaned
        assert 'Source info' not in cleaned
        assert 'Fact.' in cleaned

    def test_clean_wikipedia_markup_converts_links(self):
        e = VectorSpeechEngine(version=1, security_level='low')
        raw = "See [[Albert Einstein|Einstein]] for details."
        cleaned = e.clean_wikipedia_markup(raw)
        assert 'Einstein' in cleaned
        assert '[[' not in cleaned


# ═════════════════════════════════════════════════════════════════
# Index loading
# ═════════════════════════════════════════════════════════════════

class TestIndexLoading:
    def test_load_demo_index(self):
        if not DEMO_INDEX.exists():
            pytest.skip("Demo index not found")
        e = VectorSpeechEngine(version=1, security_level='low')
        ok = e.load_index()
        assert ok is True
        assert e.page_index is not None
        assert len(e.page_index) > 0

    def test_index_entries_have_required_fields(self):
        if not DEMO_INDEX.exists():
            pytest.skip("Demo index not found")
        e = VectorSpeechEngine(version=1, security_level='low')
        e.load_index()
        for entry in e.page_index[:10]:
            assert 'title' in entry, "Index entry must have 'title'"
            assert 'revid' in entry, "Index entry must have 'revid'"
            assert isinstance(entry['revid'], int)

    def test_demo_index_has_sufficient_articles(self):
        """Demo index must have at least enough articles for high security."""
        if not DEMO_INDEX.exists():
            pytest.skip("Demo index not found")
        e = VectorSpeechEngine(version=1, security_level='high')
        e.load_index()
        min_needed = SECURITY_PRESETS['high']['num_pages']
        assert len(e.page_index) >= min_needed, \
            f"Demo index too small: {len(e.page_index)} < {min_needed}"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
