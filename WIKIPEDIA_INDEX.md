# Wikipedia Index Golden Hash

## Level 3 Index (Shipping Default)

**Purpose:** Bootstrap corpus for VectorSpeech cryptographic messaging

### Index Metadata

- **Articles:** 1,007 (Level 3 - Vital Articles)
- **Golden Hash (SHA-256):** `83a68abe97da9a97b949b9eca36645d0a8fb0b894e3c5da23e84c95e61720327`
- **Build Date:** 2026-04-02
- **File:** `vital_articles_v3.json`
- **Size:** ~250KB

### Hash Purpose

The **golden hash** ensures that all users start with the **identical corpus**:
1. Users download or build the Wikipedia index
2. The application computes SHA-256 of the index entries
3. Hash must match `83a68...0327` for corpus integrity
4. **Different hash = different encryption key derivation = decryption failure**

### Critical: Hash Consistency

⚠️ **The hash MUST remain constant across all installations**

- Hash is computed from: `SHA256(JSON.stringify(index_entries_sorted))`
- Sorted alphabetically by title
- Deterministic JSON serialization (no whitespace, consistent ordering)
- Any change in articles, titles, or revision IDs → **new hash → incompatible encryption**

### Building Your Own Index

Users can build custom indexes for enhanced security:

```bash
# Build Level 3 (~1,000 articles, ~1 minute)
python3 build_wiki_index.py --level 3

# Build Level 4 (~10,000 articles, ~10 minutes)
python3 build_wiki_index.py --level 4

# Resume interrupted build
python3 build_wiki_index.py --level 3 --resume
```

**After building:**
1. Application displays the hash: `Index hash: 83a68abe...`
2. Share this hash with your communication partner
3. Both parties verify: Settings → Dataset → Index Hash
4. ✅ **Matching hashes** = can communicate securely
5. ❌ **Different hashes** = messages will not decrypt

### Custom Corpus

For maximum security, users can provide their own corpus:

1. **Prepare corpus files** (UTF-8 text files, URLs, or local paths)
2. **Open conversation** → Click 🔑 (key button) → Corpus Source tab
3. **Set corpus URL/path** (e.g., `https://example.com/corpus.txt`)
4. **Application computes fingerprint** (SHA-256 of all file contents)
5. **Share fingerprint out-of-band** with communication partner
6. **Both verify fingerprints match** before messaging

**Fingerprint format:**
```
Corpus fingerprint: d4f8a1c2...
Source: https://example.com/corpus.txt
```

### Verification Commands

```bash
# Verify index hash
python3 -c "
import json, hashlib
data = json.load(open('vital_articles_v3.json'))
entries = data['index']
blob = json.dumps(entries, separators=(',', ':')).encode()
print(f'Hash: {hashlib.sha256(blob).hexdigest()}')
print(f'Articles: {len(entries)}')
"

# Expected output:
# Hash: 83a68abe97da9a97b949b9eca36645d0a8fb0b894e3c5da23e84c95e61720327
# Articles: 1007
```

### FAQ

**Q: Why Level 3 instead of Level 4?**
A: Level 3 (1,000 articles) balances security with download speed. Level 4 (10,000 articles) offers stronger security but takes longer to download.

**Q: What if Wikipedia updates an article?**
A: Revision IDs are **frozen** at build time. The index references specific revision IDs, so Wikipedia updates don't affect the hash.

**Q: Can I use a different Wikipedia version?**
A: Yes! Build a new index with `python3 build_wiki_index.py --level 3`, share the new hash with your partner, and both update to the same index.

**Q: What if hashes don't match?**
A: Messages encrypted with different indexes **cannot be decrypted**. Both parties must use the exact same index or custom corpus.

**Q: Is the demo index secure?**
A: The demo index (20 articles) is **for testing only**. Use Level 3 (1,007 articles) or higher for real communication.

### Index Levels Comparison

| Level | Articles | Build Time | Security | Use Case |
|-------|----------|------------|----------|----------|
| Demo  | 20       | N/A        | ⚠️ Testing only | Development |
| 2     | ~100     | ~10s       | Low      | Quick tests |
| **3** | **~1,000** | **~1 min** | **Medium (Default)** | **Bootstrap** |
| 4     | ~10,000  | ~10 min    | High     | Enhanced security |
| 5     | ~50,000  | ~1 hour    | Very High | Maximum security |

### Golden Hash Registry

For reference and verification:

```
Level 3 (2026-04-02): 83a68abe97da9a97b949b9eca36645d0a8fb0b894e3c5da23e84c95e61720327
```

**Note:** This hash is specific to the 2026-04-02 snapshot. Future builds will have different hashes due to Wikipedia updates.

---

## For Developers

### Shipping Checklist

1. ✅ Include `vital_articles_v3.json` in distribution
2. ✅ Display hash on first run: Settings → Dataset → Index Hash
3. ✅ Validate hash matches golden hash on load
4. ✅ Document hash sharing workflow in user guide
5. ✅ Provide `build_wiki_index.py` for custom builds

### Testing

```bash
# Run Wikipedia index tests
./tests/run_tests.sh --wiki

# Verify hash in production
python3 -c "
import json
data = json.load(open('vital_articles_v3.json'))
assert data['metadata']['checksum'] == '83a68abe97da9a97b949b9eca36645d0a8fb0b894e3c5da23e84c95e61720327'
print('✓ Golden hash verified')
"
```
