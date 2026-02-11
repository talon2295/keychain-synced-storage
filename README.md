# better-auth-expo-biometric

Better Auth Expo biometric keychain storage for React Native.

## Features
- Keychain-backed encryption key
- Encrypted storage in AsyncStorage
- Optional biometric protection
- Synchronous storage interface for Better Auth

## Install

Install the package and peer dependencies in your Expo project.

## Usage

Create the storage and pass it to `expoClient`, then call `load` on app start.

Example (simplified):
- Create storage with `createKeychainSyncedStorage`.
- Call `load()` during app initialization.
- Pass `store` and `plugin` to Better Auth.

## API

### createKeychainSyncedStorage(options?)
Returns:
- `store`: sync storage for Better Auth
- `plugin`: Better Auth client plugin
- `load`: async initialization function
- `setEnableBiometrics(enabled)`
- `getBiometricsEnabled()`

Options:
- `storagePrefixKey`: base namespace for all keys. Default: baeb
- `storageVersion`: number used in key suffixes. Default: 1

Generated keys format:
- (storagePrefixKey || "baeb").service.v(version)
- (storagePrefixKey || "baeb").key.v(version)
- (storagePrefixKey || "baeb").enabled.v(version)
- (storagePrefixKey || "baeb").storage.v(version)

To avoid duplication in multi-app or multi-env setups, use a unique `storagePrefixKey` per app/environment.

### getSupportedBiometryType
Re-export from `react-native-keychain`.

## Notes
- Web is no-op.
- If the biometric prompt is canceled, storage remains empty until initialized again.
