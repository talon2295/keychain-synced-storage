# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-11

### Added
- Initial release
- In-memory storage with async encryption to AsyncStorage
- Keychain-protected encryption key storage
- Biometric authentication support (iOS Keychain & Android Keystore)
- `createKeychainSyncedStorage()` factory function
- `setEnableBiometrics()` for toggling biometric protection with key rotation
- `getBiometricsEnabled()` to check current biometric status
- `getSupportedBiometryType()` re-export from react-native-keychain
- Configurable auth prompts, storage prefix, and logging
- Support for better-auth multi-session plugin
- Automatic key rotation when changing biometric settings
- Graceful handling of user-canceled biometric prompts

### Security
- AES-256-CBC encryption for session data
- Hardware-backed keychain storage when biometric is enabled
- Software-backed keychain storage for passcode-only mode

## [0.1.1] - 2026-02-16

### Changed
- Added the new async method `setItemAsync` to the store API
- Updated documentation (`README.md`) to reflect the new async method

### Security
- Removed PBKDF2 key derivation from `generateKey` as it was redundant
