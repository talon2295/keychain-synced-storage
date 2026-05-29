# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-05-29

### Added
- `registerCustomData({ service, version })` — registers an isolated custom data namespace with its own AsyncStorage key (`{prefix}.custom.{service}.v{version}`), its own in-memory map and sync queue. Returns a typed `CustomDataAccessor` (`{ add, get, delete }`).
- `keychainVersion` option in `KeychainStorageOptions` — independently versions the Keychain entry and biometrics preference key, decoupled from `storageVersion`. Bumping `storageVersion` to migrate session data no longer rotates the encryption key or loses custom data.
- Exported types: `CustomDataRegistration`, `CustomDataAccessor`

### Changed
- `setEnableBiometrics()` now re-encrypts all registered custom data stores atomically before committing the new key to Keychain.
- `load()` now initializes all registered custom data stores in parallel after loading the main session blob.

### Removed
- `addCustomData<T>(keyName, data)` — replaced by `registerCustomData()`
- `getCustomData<T>(keyName)` — replaced by `registerCustomData()`
- `deleteCustomData(keyName)` — replaced by `registerCustomData()`

### Migration

```typescript
// Before (0.8.x)
storage.addCustomData('privateKey', keyData)
storage.getCustomData<KeyType>('privateKey')
storage.deleteCustomData('privateKey')

// After (0.9.0) — register before load()
const pkStore = storage.registerCustomData({ service: 'privateKey', version: 1 })
await storage.load()

pkStore.add('main', keyData)
pkStore.get<KeyType>('main')
pkStore.delete('main')
```

## [0.8.0] - 2026-05-28

### Fixed
- Preserve writes that occurred before `initialize()` completes: pre-init in-memory data is now merged with the persisted blob and flushed on first sync.
- Removed leftover `@noble/curves` dependency and ECDH/x25519 imports that were accidentally reintroduced.
- Removed encryption salt from key generation (redundant; the random AES-256 key is already 256 bits of entropy).

## [0.7.0] - 2026-05-21

### Changed
- Keychain entry for biometric-protected keys now uses `STORAGE_TYPE.RSA` for maximum hardware-backed security on Android.

## [0.6.0] - 2026-05-14

### Added
- `flush()` method on the store — waits for all pending background syncs to complete before resolving.

### Changed
- Sync mechanism refactored to a serialized promise chain (`syncLock`), eliminating race conditions on rapid sequential writes.

## [0.5.0] - 2026-04-21

### Added
- `addCustomData<T>(keyName, data)`, `getCustomData<T>(keyName)`, `deleteCustomData(keyName)` — type-safe helpers for storing arbitrary app data alongside session data in the same encrypted blob.

## [0.1.1] - 2026-02-16

### Changed
- Added `setItemAsync(key, value)` async write method that awaits the background encryption sync before resolving.

### Security
- Removed PBKDF2 key derivation from `generateKey` — redundant given the key is a random 256-bit value stored directly in Keychain.

## [0.1.0] - 2026-02-11

### Added
- Initial release
- In-memory storage with async AES-256-CBC encryption to AsyncStorage
- Keychain-protected encryption key storage (iOS Keychain / Android Keystore)
- Biometric authentication support via `react-native-keychain`
- `createKeychainSyncedStorage()` factory function
- `setEnableBiometrics()` for toggling biometric protection with automatic key rotation
- `getBiometricsEnabled()` to check current biometric status
- `getSupportedBiometryType()` re-export from react-native-keychain
- Configurable auth prompts, storage prefix, storage version, and logging
- Full compatibility with the better-auth Expo client and multi-session plugin
- Graceful handling of user-canceled biometric prompts
