# Security hardening (client side)

This document describes a future hardening plan for the client-side storage.
No code changes are included here.

## Goal

Provide confidentiality and integrity for encrypted blobs stored in AsyncStorage,
without prompting the user on every access.

## Recommended approach: AES-256-CTR + HMAC

Because only AES-256-CBC or AES-256-CTR are available, use
AES-256-CTR with HMAC (Encrypt-then-MAC). CTR and CBC are malleable without
authentication, so a MAC is required to detect tampering.

## Key management

- Generate a random master key (32 bytes / 256 bit) and store it in
  Keychain/Keystore.
- Do not use PBKDF2 when the key is already random.
- Derive two separate keys from the master key:
  - key_enc for encryption
  - key_mac for integrity
- Use HKDF if available; otherwise PBKDF2 can be used as a fallback.
- Use distinct context/info strings when deriving the two keys.

## Encryption flow (Encrypt-then-MAC)

1) Generate a random IV/nonce for each encryption (CTR requires unique nonces).
2) Encrypt with AES-256-CTR using key_enc.
3) Compute HMAC over: version || iv || ciphertext using key_mac.
4) Store a structured blob (JSON) containing version, iv, ciphertext, and mac.

## Decryption flow

1) Recompute HMAC over the stored fields.
2) Compare MACs in constant time.
3) If MAC verification fails, reject the blob without attempting decryption.
4) If MAC verification passes, decrypt with AES-256-CTR.

## Rotation and migration

- When biometrics are toggled, re-generate the master key and re-encrypt all
  data (current behavior, keep it).
- Include a version field in stored blobs to support migrations.

## Why this matters

- CTR/CBC without MAC allows tampering.
- Encrypt-then-MAC provides integrity and confidentiality with the tools
  currently available.
- Security is determined by when keys are accessible, not by key length alone.

## Notes

- This hardening does not change the RAM cache model. The cache exists to
  avoid frequent authentication prompts.
- The risk that remains is runtime exposure (a compromised process can read
  memory), which is expected with this UX model.
